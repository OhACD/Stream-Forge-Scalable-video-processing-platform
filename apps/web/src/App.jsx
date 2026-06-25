import React, { useState } from "react";
import TopBar from "./components/layout/TopBar.jsx";
import Sidebar from "./components/layout/Sidebar.jsx";
import VideoGrid from "./components/library/VideoGrid.jsx";
import UploadZone from "./components/upload/UploadZone.jsx";
import VideoDetail from "./components/detail/VideoDetail.jsx";
import ActivityFeed from "./components/activity/ActivityFeed.jsx";
import SessionPanel from "./components/settings/SessionPanel.jsx";
import ToastStack from "./components/common/ToastStack.jsx";
import { useSession } from "./hooks/useSession.js";
import { useVideos } from "./hooks/useVideos.js";
import { useUpload } from "./hooks/useUpload.js";
import { useToast } from "./hooks/useToast.js";
import { useActivity } from "./hooks/useActivity.js";

export default function App() {
  const [view, setView] = useState("library");
  const [selectedVideoId, setSelectedVideoId] = useState(null);

  const { session, saveSession } = useSession();
  const { toasts, addToast, dismissToast } = useToast();
  const { entries: activityEntries, log: logActivity } = useActivity();

  const { videos, loading, refresh, removeVideo, upsertVideoSnapshot } = useVideos({
    session,
    onEvent: logActivity,
  });

  const { uploadState, startUpload, resetUpload } = useUpload({
    session,
    onEvent: logActivity,
    onSuccess: () => {
      refresh();
      setView("library");
    },
  });

  function navigate(v) {
    setView(v);
    if (v !== "library") setSelectedVideoId(null);
  }

  const processingCount = videos.filter(
    (v) => v.status === "processing"
  ).length;

  return (
    <div className="app-root">
      <TopBar
        session={session}
        onSettingsClick={() => navigate("settings")}
        onLogoClick={() => navigate("library")}
      />
      <div className="app-body">
        <Sidebar
          activeView={view}
          onNavigate={navigate}
          processingCount={processingCount}
        />
        <main className="app-main">
          {view === "library" && (
            <VideoGrid
              videos={videos}
              loading={loading}
              selectedVideoId={selectedVideoId}
              onSelect={setSelectedVideoId}
              onRefresh={refresh}
              onUploadClick={() => navigate("upload")}
            />
          )}
          {view === "upload" && (
            <UploadZone
              uploadState={uploadState}
              onUpload={startUpload}
              onReset={resetUpload}
            />
          )}
          {view === "activity" && (
            <ActivityFeed entries={activityEntries} />
          )}
          {view === "settings" && (
            <SessionPanel
              session={session}
              onSave={(next) => {
                saveSession(next);
                addToast("Session credentials saved.", "ok", "Saved");
              }}
            />
          )}
        </main>
        {selectedVideoId && view === "library" && (
          <VideoDetail
            videoId={selectedVideoId}
            session={session}
            onClose={() => setSelectedVideoId(null)}
            onDelete={(id) => {
              setSelectedVideoId(null);
              removeVideo(id, session).catch((err) =>
                addToast(err.message, "bad", "Delete failed")
              );
            }}
            addToast={addToast}
            onActivityEvent={logActivity}
            onVideoSnapshot={upsertVideoSnapshot}
          />
        )}
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
