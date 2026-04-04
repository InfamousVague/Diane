import { useState } from "react";
import { Recorder } from "./components/Recorder";
import { CassetteLibrary } from "./components/CassetteLibrary";
import "./App.css";

export type Recording = {
  id: string;
  date: number;
  duration: number;
  transcript: string;
  label: string;
};

type View = "recorder" | "library";

export function App() {
  const [view, setView] = useState<View>("recorder");
  const [recordings, setRecordings] = useState<Recording[]>([]);

  const handleNewRecording = (rec: Recording) => {
    setRecordings((prev) => [rec, ...prev]);
  };

  return (
    <div className="diane" data-tauri-drag-region>
      {view === "recorder" ? (
        <Recorder
          onRecordingComplete={handleNewRecording}
          onShowLibrary={() => setView("library")}
          recordingCount={recordings.length}
        />
      ) : (
        <CassetteLibrary
          recordings={recordings}
          onBack={() => setView("recorder")}
        />
      )}
    </div>
  );
}
