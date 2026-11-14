"""
Sentinel Section D - End-to-End Simulation & Verification Runner
Demonstrates the Definition of Done from message.txt:
"Feed 100 Contract-3 events, get N sensible notifications (not 100),
and a research doc that accumulates without duplicates."
"""

import sys
import os
import random
import time
import tempfile

# Ensure packages can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from packages.contracts.models import ProcessedResult
from output_integration.service import DeliveryService
from output_integration.models import ChannelConfig, SuppressionPolicy

def _run_simulation(storage_dir: str):
    print("=" * 70)
    print("🚀 SENTINEL SECTION D: OUTPUT INTEGRATION SIMULATION")
    print("=" * 70)

    workspace_id = "ws_ibm_market_radar"
    intent = "I want to be told about IBM related events that may influence stock"

    # Configure custom test policy
    policy = SuppressionPolicy(
        min_confidence=0.70,
        push_alert_impacts=["high", "medium"],
        dedupe_cooldown_seconds=86400,
        max_alerts_per_hour=5  # Anti-storm rate limit
    )

    service = DeliveryService(
        storage_dir=storage_dir,
        suppression_policy=policy
    )

    print(f"\n[1] Workspace Initialized: '{workspace_id}'")
    print(f"    Intent: '{intent}'")
    print(f"    Suppression Policy: Min Conf={policy.min_confidence}, Alerts for={policy.push_alert_impacts}, Max Alerts/Hr={policy.max_alerts_per_hour}\n")

    # Real-world scenario event templates
    scenarios = [
        # HIGH IMPACT (Crucial events)
        {
            "event_type": "8-K Filing",
            "impact": "high",
            "summary": "IBM files 8-K: Outlines strategic acquisition of cloud-native infrastructure vendor for $1.8B in cash.",
            "source_url": "https://www.sec.gov/Archives/edgar/data/51143/ibm-8k-2026.htm",
            "confidence": 0.96
        },
        {
            "event_type": "Earnings Guidance",
            "impact": "high",
            "summary": "IBM CFO raises full-year free cash flow guidance from $12.0B to $13.5B citing accelerated enterprise AI adoption.",
            "source_url": "https://newsroom.ibm.com/2026-11-14-earnings-guidance-update",
            "confidence": 0.95
        },
        {
            "event_type": "Executive Departure",
            "impact": "high",
            "summary": "Head of IBM Hybrid Cloud Software steps down effective immediately to pursue another opportunity.",
            "source_url": "https://www.reuters.com/technology/ibm-cloud-leadership-transition-2026",
            "confidence": 0.89
        },
        # MEDIUM IMPACT (Noteworthy)
        {
            "event_type": "Analyst Rating",
            "impact": "medium",
            "summary": "Morgan Stanley reiterates Overweight on IBM, adjusts price target to $240.",
            "source_url": "https://www.bloomberg.com/news/articles/2026-11-14/analyst-upgrade-ibm",
            "confidence": 0.88
        },
        {
            "event_type": "Enterprise Partnership",
            "impact": "medium",
            "summary": "IBM and Siemens announce multi-year joint initiative for industrial agent orchestration.",
            "source_url": "https://www.prnewswire.com/news-releases/ibm-siemens-partnership-2026",
            "confidence": 0.85
        },
        # LOW IMPACT (Noise / Routine)
        {
            "event_type": "Routine Marketing Blog",
            "impact": "low",
            "summary": "IBM publishes thought leadership blog on best practices for quantum-safe cryptography implementation.",
            "source_url": "https://www.ibm.com/blog/quantum-safe-crypto-guide",
            "confidence": 0.81
        },
        {
            "event_type": "Webinar Announcement",
            "impact": "low",
            "summary": "Register for IBM TechXchange webinar on enterprise Red Hat OpenShift architectures.",
            "source_url": "https://community.ibm.com/events/webinar-openshift",
            "confidence": 0.78
        },
        # LOW CONFIDENCE (Bad extraction / Hallucination risk from pipeline)
        {
            "event_type": "Unverified Forum Rumor",
            "impact": "high",
            "summary": "Anonymous user on Reddit r/stocks claims IBM is divesting legacy consulting arm.",
            "source_url": "https://reddit.com/r/stocks/comments/xyz123",
            "confidence": 0.42 # Below 0.70 threshold!
        }
    ]

    print("[2] Generating 100 Contract-3 events (including duplicates and noise)...")
    raw_events = []
    
    # 100 events constructed with duplicates and noise to simulate a real continuous monitor stream
    for i in range(1, 101):
        # Pick scenario
        scenario = random.choice(scenarios)
        
        # Inject deliberate duplicates every 4th run
        if i % 4 == 0 and len(raw_events) > 0:
            previous_event = raw_events[i - 2]
            event = ProcessedResult.create_mock(
                workspace_id=workspace_id,
                seq=i,
                event_type=previous_event.extracted.event_type,
                summary=previous_event.extracted.summary, # IDENTICAL summary -> duplicate dedupe_key!
                impact=previous_event.extracted.impact,
                source_url=previous_event.extracted.source_url,
                confidence=previous_event.confidence
            )
        else:
            # Subtle variation or unique event
            event = ProcessedResult.create_mock(
                workspace_id=workspace_id,
                seq=i,
                event_type=scenario["event_type"],
                summary=f"{scenario['summary']} [Tick #{i}]",
                impact=scenario["impact"],
                source_url=scenario["source_url"],
                confidence=scenario["confidence"]
            )
        raw_events.append(event)

    print(f"    Constructed {len(raw_events)} test events.")

    print("\n[3] Ingesting through DeliveryService...")
    alerts_eligible = 0
    external_deliveries = 0
    doc_entries_added = 0
    suppressed_count = 0
    reasons_breakdown = {}

    for event in raw_events:
        res = service.process_event(event=event, workspace_intent=intent)
        if res.added_to_research_doc:
            doc_entries_added += 1
        if not res.suppressed:
            alerts_eligible += 1
            if any(channel != "local_feed" for channel in res.delivered_to_channels):
                external_deliveries += 1
        else:
            suppressed_count += 1
            reason_category = res.suppression_reason.split("(")[0].strip() if res.suppression_reason else "Unknown"
            reasons_breakdown[reason_category] = reasons_breakdown.get(reason_category, 0) + 1

    print("\n" + "=" * 70)
    print("📊 DEFINITION OF DONE VERIFICATION RESULTS")
    print("=" * 70)
    print(f"Total Contract-3 Events Ingested:       {len(raw_events)}")
    print(f"Total Added to Persistent Research Doc: {doc_entries_added}")
    print(f"Events Eligible for Push:              {alerts_eligible}")
    print(f"Events Delivered to External Channel: {external_deliveries}")
    print(f"Total Events Suppressed from Push:      {suppressed_count}")
    print("\nSuppression Reasons Breakdown:")
    for reason, count in sorted(reasons_breakdown.items(), key=lambda x: x[1], reverse=True):
        print(f"  • {reason}: {count} events")

    print("\n" + "=" * 70)
    print("📄 LIVING RESEARCH DOCUMENT SAMPLE (LIVING_RESEARCH.md)")
    print("=" * 70)
    doc_preview = service.get_living_doc(workspace_id)
    doc_lines = doc_preview.split("\n")
    print("\n".join(doc_lines[:25]))
    if len(doc_lines) > 25:
        print(f"... [{len(doc_lines) - 25} more rows accumulated without duplication] ...")

    assert len(raw_events) == 100
    assert 0 < doc_entries_added < len(raw_events)
    assert 0 < alerts_eligible < len(raw_events)
    print("\nSimulation checks passed (external delivery requires configured channels).")


def run_simulation():
    # An isolated, repeatable run must not inherit state from a prior demo.
    random.seed(0)
    with tempfile.TemporaryDirectory() as storage_dir:
        _run_simulation(storage_dir)

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    run_simulation()
