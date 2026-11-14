import tempfile
import unittest

from output_integration.service import DeliveryService
from packages.contracts.models import ProcessedResult


class DeliveryDedupeTests(unittest.TestCase):
    def test_rejected_low_confidence_does_not_hide_later_verified_event(self):
        with tempfile.TemporaryDirectory() as storage_dir:
            service = DeliveryService(storage_dir=storage_dir)

            def event(seq, confidence):
                return ProcessedResult.create_mock(
                    workspace_id="demo",
                    seq=seq,
                    event_type="alert",
                    summary="Same finding",
                    impact="high",
                    source_url="https://example.com/source",
                    confidence=confidence,
                )

            rejected = service.process_event(event(1, 0.4))
            accepted = service.process_event(event(2, 0.95))
            duplicate = service.process_event(event(3, 0.95))

            self.assertTrue(rejected.suppressed)
            self.assertFalse(rejected.added_to_research_doc)
            self.assertFalse(accepted.suppressed)
            self.assertTrue(accepted.added_to_research_doc)
            self.assertTrue(duplicate.suppressed)
            self.assertFalse(duplicate.added_to_research_doc)


if __name__ == "__main__":
    unittest.main()
