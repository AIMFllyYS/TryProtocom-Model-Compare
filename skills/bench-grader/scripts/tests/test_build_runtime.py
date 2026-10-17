"""Regression for evaluator launch failures, separate from submitted source quality."""
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from benchlib.common import Metrics
from benchlib.probes.build import node_tools, build_probe


class BuildRuntimeTests(unittest.TestCase):
    def test_configured_node_uses_its_bundled_cli_and_child_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            node = root / "node.exe"
            node.write_bytes(b"")
            bin_dir = root / "node_modules/npm/bin"
            bin_dir.mkdir(parents=True)
            for tool in ("npm", "npx"):
                (bin_dir / f"{tool}-cli.js").write_text("", encoding="utf-8")
            commands, env = node_tools({"external": {"api_node": str(node)}})
            self.assertEqual(commands["npm"], [str(node.resolve()), str(bin_dir.resolve() / "npm-cli.js")])
            self.assertEqual(commands["npx"], [str(node.resolve()), str(bin_dir.resolve() / "npx-cli.js")])
            self.assertEqual(env["PATH"].split(os.pathsep)[0], str(root.resolve()))

    def test_missing_configured_cli_cannot_fall_back_to_global_npm(self):
        with tempfile.TemporaryDirectory() as tmp:
            node = Path(tmp) / "node.exe"
            node.write_bytes(b"")
            with self.assertRaisesRegex(FileNotFoundError, "npm"):
                node_tools({"external": {"api_node": str(node)}})

    def test_partial_regrade_clears_old_build_results_but_keeps_other_probes(self):
        with tempfile.TemporaryDirectory() as tmp:
            metrics = Metrics(values={"build.tsc_errors": 99, "build.rebuild_ok": True, "api.tests_passed": 48}, na={"build.install_ok": "old environment"})
            ctx = SimpleNamespace(metrics=metrics, project_root=lambda: Path(tmp))
            build_probe(ctx, {})
            self.assertEqual(metrics.values, {"api.tests_passed": 48, "build.package_json": False})
            self.assertEqual(metrics.na, {})


if __name__ == "__main__":
    unittest.main()
