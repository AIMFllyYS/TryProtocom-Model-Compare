"""自动检查探针。每个探针：run(ctx: RunContext, opts: dict) -> None，把指标写入 ctx.metrics。"""
from . import api, browser, build, static, timeline, video

REGISTRY = {
    "files": static.files_probe,
    "claims": static.claims_probe,
    "docs": static.docs_probe,
    "transcript": static.transcript_probe,
    "diff": static.diff_probe,
    "mcproject": static.mc_probe,
    "browser": browser.browser_probe,
    "timeline": timeline.timeline_probe,
    "video": video.video_probe,
    "build": build.build_probe,
    "api": api.api_probe,
}
