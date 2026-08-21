"""Backend tests for the ChatWeave framework migration:
status serialization (overview bullets only),
admin dashboard Construct/Apply/Evolve/Scrutability re-key, and
seed-file isolation."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import pytest

import main as backend_main
from main import _build_coverage_str, _serialize_status_to_str

MAIN_SRC = (Path(__file__).parent.parent / "backend" / "main.py").read_text()


@pytest.fixture(autouse=True)
def isolate_db(tmp_path, monkeypatch):
    monkeypatch.setattr(backend_main, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(backend_main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(backend_main, "SEED_PATH", tmp_path / "seed_events.json")
    backend_main._init_db()
    yield


# ── Status serialization (overview-only) ──────────────────────────────────────

class TestSerializeStatusOverview:
    def test_dict_overview_items_use_text(self):
        out = _serialize_status_to_str({
            "overview": [{"text": "Knows Python", "source": "user"}],
        })
        assert "- Knows Python" in out
        assert "source" not in out, "dict repr must not leak into prompts"

    def test_string_overview_items_still_work(self):
        out = _serialize_status_to_str({"overview": ["Legacy bullet"]})
        assert "- Legacy bullet" in out

    def test_mixed_overview_items(self):
        out = _serialize_status_to_str({
            "overview": ["old style", {"text": "new style", "source": "inferred"}],
        })
        assert "- old style" in out
        assert "- new style" in out

    def test_plain_string_status_passthrough(self):
        assert _serialize_status_to_str("just a string") == "just a string"

    def test_includes_goals_section(self):
        out = _serialize_status_to_str({
            "overview": [{"text": "Knows Python"}],
            "goals": [{"text": "Explore generative AI system design"}],
        })
        assert "Goals:" in out
        assert "Explore generative AI system design" in out


class TestSerializeStatusOverviewOnly:
    """concepts_traversed / stance phrasing removed — serialize overview only."""

    def test_ignores_concepts_traversed(self):
        out = _serialize_status_to_str({
            "overview": [{"text": "Knows Python"}],
            "concepts_traversed": [
                {"title": "A", "stance": "interested"},
                {"title": "B", "stance": "understood"},
            ],
        })
        assert "- Knows Python" in out
        assert "A" not in out
        assert "B" not in out
        assert "User flagged interest" not in out
        assert "familiar" not in out

    def test_empty_overview_with_legacy_concepts_is_empty(self):
        out = _serialize_status_to_str({
            "overview": [],
            "concepts_traversed": [{"title": "A", "stance": "interested"}],
        })
        assert out == ""

    def test_no_stance_phrasing_in_output(self):
        out = _serialize_status_to_str({
            "overview": ["Interested in NLP"],
            "concepts_traversed": [{"title": "SVM", "stance": "not_interested"}],
        })
        assert out == "- Interested in NLP"
        assert "User dismissed" not in out
        assert "Concepts encountered" not in out

    def test_no_stance_context_in_main(self):
        assert "stance_context" not in MAIN_SRC


class TestBuildCoverageStr:
    def test_overview_and_past_chats(self):
        out = _build_coverage_str(
            {"overview": [{"text": "Knows Python"}, "Uses PyTorch"]},
            [{"title": "NN intro", "summary": "Covered backprop"}],
        )
        assert "- Knows Python" in out
        assert "- Uses PyTorch" in out
        assert "- Past chat: NN intro — Covered backprop" in out

    def test_empty_is_none_yet(self):
        assert _build_coverage_str({"overview": []}, []) == "None yet."
        assert _build_coverage_str(None, None) == "None yet."

    def test_string_topic_status(self):
        out = _build_coverage_str("Legacy profile text", [])
        assert "Legacy profile text" in out

    def test_ignores_concepts_traversed(self):
        out = _build_coverage_str(
            {"overview": ["Goal: NLP"], "concepts_traversed": [{"title": "SVM"}]},
            [],
        )
        assert "SVM" not in out
        assert "- Goal: NLP" in out


# ── Admin dashboard re-key (Phase 8) ─────────────────────────────────────────

class TestAdminDashboardCategories:
    def test_table_headers_renamed(self):
        html = backend_main._ADMIN_HTML
        assert "<th>Construct</th><th>Apply</th><th>Evolve</th><th>Scrutability</th>" in html
        assert "<th>Mod 1</th>" not in html

    def test_category_arrays_defined(self):
        html = backend_main._ADMIN_HTML
        for name in ("const CONSTRUCT =", "const APPLY =", "const EVOLVE =", "const SCRUTABILITY ="):
            assert name in html
        assert "const MOD1" not in html

    def test_construct_events(self):
        html = backend_main._ADMIN_HTML
        for e in ("proposal_shown", "proposal_accepted", "proposal_edited",
                  "proposal_dismissed", "current_profile_edited",
                  "text_label_applied", "text_label_removed"):
            assert f"'{e}'" in html
        assert "current_concept_stance_set" not in html
        assert "current_concept_toggled" not in html

    def test_apply_events(self):
        html = backend_main._ADMIN_HTML
        for e in ("context_card_shown", "context_excluded_for_topic",
                  "context_link_opened", "connection_contested"):
            assert f"'{e}'" in html
        assert "context_suppressed_in_chat" not in html

    def test_evolve_events(self):
        html = backend_main._ADMIN_HTML
        for e in ("goal_saved", "goal_authored", "goal_question_asked",
                  "directions_refreshed"):
            assert f"'{e}'" in html

    def test_scrutability_events(self):
        html = backend_main._ADMIN_HTML
        for e in ("update_undone", "version_restored"):
            assert f"'{e}'" in html

    def test_dashboard_served(self):
        from fastapi.testclient import TestClient
        resp = TestClient(backend_main.app).get("/admin")
        assert resp.status_code == 200
        assert "Scrutability" in resp.text

    def test_new_events_accepted_by_log_endpoint(self):
        from fastapi.testclient import TestClient
        client = TestClient(backend_main.app)
        for evt in ("proposal_shown", "intention_saved", "connection_contested",
                    "context_item_scoped", "update_undone", "version_restored",
                    "text_label_applied", "text_comment_committed"):
            resp = client.post("/api/log", json={
                "userId": "mig01", "condition": "loom", "eventType": evt,
                "data": {"stage": "construct", "initiative": "user"},
            })
            assert resp.status_code == 200
        events = client.get("/api/admin/events").json()
        types = {e["eventType"] for e in events}
        assert "proposal_shown" in types and "version_restored" in types


class TestSerializeAnnotations:
    def test_empty(self):
        assert backend_main._serialize_annotations([]) == "(none)"
        assert backend_main._serialize_annotations(None) == "(none)"

    def test_interested_and_comment(self):
        text = backend_main._serialize_annotations([
            {"spanText": "backprop", "label": "interested"},
            {"spanText": "dropout", "label": "comment", "comment": "I use this at work"},
            {"spanText": "GAN intro", "label": "not_relevant"},
        ])
        assert '"backprop" → important' in text
        assert 'comment: "I use this at work"' in text
        assert "GAN intro" not in text

    def test_supported_labels_and_malformed_entries(self):
        text = backend_main._serialize_annotations([
            None,
            "not a mapping",
            {"spanText": "key detail", "label": "important"},
            {"spanText": "unclear part", "label": "unsure"},
            {"spanText": "", "label": "comment", "comment": "Unicode 日本語"},
            {"spanText": "deprecated", "label": "clear"},
            {"spanText": "unknown", "label": "made_up"},
        ])
        assert '"key detail" → important' in text
        assert '"unclear part" → unsure' in text
        assert 'comment: "Unicode 日本語"' in text
        assert "deprecated" not in text
        assert "unknown" not in text


# ── Seed file isolation ───────────────────────────────────────────────────────

class TestSeedFileIsolation:
    def test_seed_path_is_module_constant(self):
        assert hasattr(backend_main, "SEED_PATH")

    def test_init_db_seeds_from_seed_path(self, tmp_path):
        seed = tmp_path / "seed_events.json"
        seed.write_text(json.dumps([{
            "userId": "seeded", "condition": "loom", "eventType": "session_start",
            "data": {}, "timestamp": "2026-01-01T00:00:00",
        }]))
        backend_main.DB_PATH.unlink(missing_ok=True)
        backend_main._init_db()
        events = backend_main._get_all_events_json()
        assert any(e["userId"] == "seeded" for e in events)

    def test_update_seed_file_writes_to_seed_path(self, tmp_path):
        from fastapi.testclient import TestClient
        client = TestClient(backend_main.app)
        client.post("/api/log", json={
            "userId": "u1", "condition": "loom", "eventType": "query_sent", "data": {},
        })
        backend_main._update_seed_file()
        seed = tmp_path / "seed_events.json"
        assert seed.exists()
        data = json.loads(seed.read_text())
        assert any(e["eventType"] == "query_sent" for e in data)
