"""
Suppression & Threshold Engine
Evaluates Contract-3 events against noise-reduction rules to eliminate alert fatigue:
1. Monotonic sequence deduplication
2. Confidence gate (discard low-confidence extractions)
3. Deduplication (cooldown on identical dedupe_key)
4. Quiet hours policy (suppress non-critical push notifications during sleep hours)
5. Impact routing (only high/medium trigger push notifications; low impact quietly logs to research doc)
6. Hourly rate-limiting (caps alerts per workspace/hour to prevent storming)
"""

import time
from typing import Tuple, Optional
try:
    from packages.contracts.models import ProcessedResult
    from .models import SuppressionPolicy
    from .store import ChangeStateStore
except ImportError:
    from searchHack.packages.contracts.models import ProcessedResult
    from searchHack.output_integration.models import SuppressionPolicy
    from searchHack.output_integration.store import ChangeStateStore

class SuppressionEngine:
    def __init__(self, store: ChangeStateStore):
        self.store = store

    def is_in_quiet_hours(self, policy: SuppressionPolicy) -> bool:
        if not policy.quiet_hours_enabled:
            return False
        current_hour = time.gmtime().tm_hour  # 0..23 UTC
        start = policy.quiet_hours_start
        end = policy.quiet_hours_end

        if start > end:
            # e.g., 22 (10 PM) to 7 (7 AM) spans midnight
            return current_hour >= start or current_hour < end
        else:
            # e.g., 1 to 5
            return start <= current_hour < end

    def evaluate(
        self,
        event: ProcessedResult,
        policy: SuppressionPolicy
    ) -> Tuple[bool, bool, Optional[str]]:
        """
        Determines:
        1. should_add_to_doc: Whether event belongs in the persistent research doc.
        2. should_send_push_alert: Whether event should trigger Slack/Discord/WhatsApp/Telegram push.
        3. suppression_reason: Explanation if push alert is suppressed.
        """
        ws_id = event.workspace_id
        
        # 1. Monotonic Seq Check
        if self.store.is_seq_processed(ws_id, event.seq):
            return False, False, f"Duplicate sequence ID {event.seq} already processed"

        # 2. Confidence Threshold
        if event.confidence < policy.min_confidence:
            return False, False, f"Confidence {event.confidence:.2f} below threshold {policy.min_confidence:.2f}"

        # 3. Deduplication Check on dedupe_key
        if self.store.is_key_duplicate(ws_id, event.dedupe_key, policy.dedupe_cooldown_seconds):
            return False, False, f"Duplicate event key '{event.dedupe_key[:12]}...' seen within cooldown"

        # At this point, the event is novel and high-enough confidence to record in research doc!
        should_add_to_doc = True
        impact = event.extracted.impact.lower()

        # 4. Impact Filtering for Push Alerts
        if impact not in [imp.lower() for imp in policy.push_alert_impacts]:
            # Kept in doc, but suppressed from push notifications!
            return should_add_to_doc, False, f"Impact '{impact}' does not meet push threshold ({policy.push_alert_impacts})"

        # 5. Quiet Hours Policy (message.txt requirement)
        if self.is_in_quiet_hours(policy):
            if not (policy.quiet_hours_allow_high_impact and impact == "high"):
                return should_add_to_doc, False, f"Suppressed by Quiet Hours ({policy.quiet_hours_start}:00-{policy.quiet_hours_end}:00 UTC)"

        # 6. Rate Limiting Check (Anti-Storming)
        recent_alerts = self.store.get_recent_alert_count(ws_id, window_seconds=3600)
        if recent_alerts >= policy.max_alerts_per_hour:
            return should_add_to_doc, False, f"Rate limit reached ({recent_alerts}/{policy.max_alerts_per_hour} alerts/hr)"

        # Both doc and push alert approved!
        return should_add_to_doc, True, None
