"use client";

import { useState, useRef } from "react";
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  VolumeX,
  Mic,
  Upload,
  Trash2,
  Plus
} from "lucide-react";

interface AudioTrack {
  id: string;
  name: string;
  type: "voice" | "music" | "sound" | "ambience";
  volume: number;
  isMuted: boolean;
  startTime: number;
}

interface AudioEditorProps {
  duration: number;
  onTrackAdd?: (track: AudioTrack) => void;
  onTrackRemove?: (id: string) => void;
  onTrackUpdate?: (id: string, updates: Partial<AudioTrack>) => void;
}

export function AudioEditor({ duration, onTrackAdd, onTrackRemove, onTrackUpdate }: AudioEditorProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [tracks, setTracks] = useState<AudioTrack[]>([
    { id: "1", name: "Original Audio", type: "voice", volume: 1, isMuted: false, startTime: 0 },
  ]);
  const [isRecording, setIsRecording] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
    // In a real implementation, this would control audio playback
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleAddTrack = (type: AudioTrack["type"]) => {
    const newTrack: AudioTrack = {
      id: Math.random().toString(36).substr(2, 9),
      name: `New ${type}`,
      type,
      volume: 1,
      isMuted: false,
      startTime: 0,
    };
    setTracks([...tracks, newTrack]);
    onTrackAdd?.(newTrack);
  };

  const handleRemoveTrack = (id: string) => {
    setTracks(tracks.filter((t) => t.id !== id));
    onTrackRemove?.(id);
  };

  const handleVolumeChange = (id: string, volume: number) => {
    setTracks(tracks.map((t) => (t.id === id ? { ...t, volume } : t)));
    onTrackUpdate?.(id, { volume });
  };

  const handleMuteToggle = (id: string) => {
    setTracks(tracks.map((t) => (t.id === id ? { ...t, isMuted: !t.isMuted } : t)));
  };

  return (
    <div className="bg-[#111] rounded-2xl overflow-hidden border border-[#2a2a2a] p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-medium">Audio Tracks</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAddTrack("voice")}
            className="px-3 py-1 text-xs bg-[#252525] hover:bg-[#333] rounded text-gray-300"
          >
            + Voice
          </button>
          <button
            onClick={() => handleAddTrack("music")}
            className="px-3 py-1 text-xs bg-[#252525] hover:bg-[#333] rounded text-gray-300"
          >
            + Music
          </button>
          <button
            onClick={() => handleAddTrack("sound")}
            className="px-3 py-1 text-xs bg-[#252525] hover:bg-[#333] rounded text-gray-300"
          >
            + Sound
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <button 
            onClick={() => setCurrentTime(Math.max(0, currentTime - 1))}
            className="p-1 hover:bg-[#252525] rounded"
          >
            <SkipBack className="w-3 h-3 text-gray-400" />
          </button>
          <button 
            onClick={togglePlay}
            className="p-1 bg-lime-500 hover:bg-lime-400 rounded"
          >
            {isPlaying ? (
              <Pause className="w-3 h-3 text-black" />
            ) : (
              <Play className="w-3 h-3 text-black ml-0.5" />
            )}
          </button>
          <button 
            onClick={() => setCurrentTime(Math.min(duration, currentTime + 1))}
            className="p-1 hover:bg-[#252525] rounded"
          >
            <SkipForward className="w-3 h-3 text-gray-400" />
          </button>
          <span className="text-xs text-gray-400 ml-2">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
        
        {/* Waveform placeholder */}
        <div className="h-16 bg-[#1a1a1a] rounded-lg relative overflow-hidden">
          {/* Simulated waveform */}
          <div className="absolute inset-0 flex items-center px-2">
            {Array.from({ length: 100 }).map((_, i) => (
              <div
                key={i}
                className="w-1 bg-lime-400/30 mx-0.5 rounded"
                style={{ 
                  height: `${Math.random() * 100}%`,
                  opacity: currentTime / duration > i / 100 ? 1 : 0.3
                }}
              />
            ))}
          </div>
          
          {/* Playhead */}
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-lime-400"
            style={{ left: `${(currentTime / duration) * 100}%` }}
          />
        </div>
      </div>

      {/* Tracks */}
      <div className="space-y-2">
        {tracks.map((track) => (
          <div
            key={track.id}
            className="flex items-center gap-3 p-3 bg-[#1a1a1a] rounded-lg"
          >
            <button
              onClick={() => handleMuteToggle(track.id)}
              className={`p-1 rounded ${track.isMuted ? "text-red-400" : "text-gray-400"}`}
            >
              {track.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            
            <div className="flex-1">
              <p className="text-sm text-white">{track.name}</p>
              <p className="text-xs text-gray-500 capitalize">{track.type}</p>
            </div>
            
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={track.volume}
              onChange={(e) => handleVolumeChange(track.id, parseFloat(e.target.value))}
              className="w-24"
            />
            
            <button
              onClick={() => handleRemoveTrack(track.id)}
              className="p-1 hover:bg-[#333] rounded"
            >
              <Trash2 className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        ))}
      </div>

      {/* Record button */}
      <div className="mt-4 flex justify-center">
        <button
          onClick={() => setIsRecording(!isRecording)}
          className={`flex items-center gap-2 px-4 py-2 rounded-full transition-colors ${
            isRecording
              ? "bg-red-500 text-white"
              : "bg-[#252525] hover:bg-[#333] text-gray-300"
          }`}
        >
          <Mic className="w-4 h-4" />
          {isRecording ? "Stop Recording" : "Record Voice"}
        </button>
      </div>
    </div>
  );
}
