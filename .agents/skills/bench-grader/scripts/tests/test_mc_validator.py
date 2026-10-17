"""A repaired evaluator dependency must remove its old N/A exemption."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from benchlib.common import Metrics, RunContext
from benchlib.probes.static import mc_probe

def test_available_failing_validator_replaces_previous_na(tmp_path):
    skill=tmp_path/'skill';(skill/'scripts').mkdir(parents=True)
    (skill/'scripts/validate_project.py').write_text("print('Warnings:\\n- warning\\nErrors:\\n- invalid project'); raise SystemExit(1)",encoding='utf-8')
    rd=tmp_path/'run';(rd/'output/project').mkdir(parents=True)
    m=Metrics(na={'mc.validate_*':'previously missing evaluator'})
    ctx=RunContext(run_dir=rd,meta={},rubric={'deliverable_dir':'project'},cfg={'external':{'minecraft_skill_dir':str(skill)}},metrics=m)
    mc_probe(ctx,{})
    assert m.is_na('mc.validate_pass') is None
    assert m.values['mc.validate_ran'] is True
    assert m.values['mc.validate_pass'] is False
    assert m.values['mc.validate_errors']==1
    assert m.values['mc.validate_warnings']==1
