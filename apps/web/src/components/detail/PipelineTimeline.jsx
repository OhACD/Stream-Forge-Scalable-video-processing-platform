import React from "react";
import { IconCheck, IconAlertCircle } from "../Icons.jsx";

const STAGES = [
  { id: "upload",       label: "Upload",       desc: "Source file received by storage." },
  { id: "metadata",     label: "Metadata",     desc: "Probe codec, resolution and duration." },
  { id: "thumbnail",    label: "Thumbnail",    desc: "Generate poster frames and previews." },
  { id: "transcode",    label: "Transcode",    desc: "Produce adaptive bitrate variants." },
  { id: "notification", label: "Notification", desc: "Notify user and downstream systems." },
];

function stageClass(stage, video) {
  if (!video) return "stage-pending";
  const status   = video.status;
  const active   = video.processingStage ?? video.activeStage;
  const activeIdx = STAGES.findIndex((s) => s.id === active);
  const thisIdx   = STAGES.findIndex((s) => s.id === stage);

  if (status === "ready") return "stage-done";
  if (status === "failed" && stage === active) return "stage-failed";
  if (thisIdx < activeIdx) return "stage-done";
  if (thisIdx === activeIdx) return "stage-active";
  return "stage-pending";
}

function StageBullet({ cls }) {
  if (cls === "stage-done")   return <IconCheck size={13} />;
  if (cls === "stage-failed") return <IconAlertCircle size={13} />;
  if (cls === "stage-active") {
    return <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--work)", display: "block" }} />;
  }
  return <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--text-muted)", opacity: 0.4, display: "block" }} />;
}

export default function PipelineTimeline({ video }) {
  return (
    <ol className="pipeline-list" aria-label="Processing pipeline">
      {STAGES.map(({ id, label, desc }) => {
        const cls = stageClass(id, video);
        return (
          <li key={id} className={`pipeline-stage ${cls}`}>
            <div className="stage-bullet" aria-label={cls.replace("stage-", "")}>
              <StageBullet cls={cls} />
            </div>
            <div className="stage-content">
              <p className="stage-label">{label}</p>
              <p className="stage-desc">{desc}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
