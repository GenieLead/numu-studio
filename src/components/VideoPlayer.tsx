"use client";

import { useState, useRef } from "react";
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  VolumeX,
  Maximize,
  Scissors,
  MessageSquare,
  Camera
} from "lucide-react";

interface VideoPlayerProps {
  src: string;
  onFrameSelect?: (frame: number) => void;
  onTimeRangeSelect?: (start: number, end: number) => void;
}

export function VideoPlayer({ src, onFrameSelect, onTimeRangeSelect }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleFrameClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
      const time = percentage * duration;
      videoRef.current.currentTime = time;
      setCurrentTime(time);
      onFrameSelect?.(Math.floor(time * 30)); // Assuming 30fps
    }
  };

  const handleSelectionStart = () => {
    setSelectionStart(currentTime);
  };

  const handleSelectionEnd = () => {
    setSelectionEnd(currentTime);
    if (selectionStart !== null) {
      onTimeRangeSelect?.(selectionStart, currentTime);
    }
  };

  return (
    <div className="bg-[#111] rounded-2xl overflow-hidden border border-[#2a2a2a]">
      {/* Video */}
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-contain"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onClick={togglePlay}
        />
        
        {/* Play/Pause overlay */}
        {!isPlaying && (
          <div 
            className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer"
            onClick={togglePlay}
          >
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
              <Play className="w-8 h-8 text-white ml-1" />
            </div>
          </div>
        )}

        {/* Selection indicators */}
        {selectionStart !== null && (
          <div 
            className="absolute top-0 bottom-0 w-1 bg-lime-400"
            style={{ left: `${(selectionStart / duration) * 100}%` }}
          />
        )}
        {selectionEnd !== null && (
          <div 
            className="absolute top-0 bottom-0 w-1 bg-lime-400"
            style={{ left: `${(selectionEnd / duration) * 100}%` }}
          />
        )}
      </div>

      {/* Progress Bar */}
      <div className="px-4 py-2">
        <div 
          className="relative h-1 bg-[#333] rounded-full cursor-pointer"
          onClick={handleFrameClick}
        >
          <div 
            className="absolute h-full bg-lime-400 rounded-full"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="px-4 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => videoRef.current && (videoRef.current.currentTime -= 10)}
            className="p-2 hover:bg-[#252525] rounded-lg"
          >
            <SkipBack className="w-4 h-4 text-gray-400" />
          </button>
          <button 
            onClick={togglePlay}
            className="p-2 bg-lime-500 hover:bg-lime-400 rounded-lg"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 text-black" />
            ) : (
              <Play className="w-4 h-4 text-black ml-0.5" />
            )}
          </button>
          <button 
            onClick={() => videoRef.current && (videoRef.current.currentTime += 10)}
            className="p-2 hover:bg-[#252525] rounded-lg"
          >
            <SkipForward className="w-4 h-4 text-gray-400" />
          </button>
          
          <span className="text-sm text-gray-400 ml-2">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 hover:bg-[#252525] rounded-lg"
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-gray-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-gray-400" />
            )}
          </button>
          
          <button 
            onClick={handleSelectionStart}
            className="px-3 py-1 text-xs bg-[#252525] hover:bg-[#333] rounded text-gray-300"
          >
            Set Start
          </button>
          <button 
            onClick={handleSelectionEnd}
            className="px-3 py-1 text-xs bg-[#252525] hover:bg-[#333] rounded text-gray-300"
          >
            Set End
          </button>
          
          <button className="p-2 hover:bg-[#252525] rounded-lg">
            <Scissors className="w-4 h-4 text-gray-400" />
          </button>
          <button className="p-2 hover:bg-[#252525] rounded-lg">
            <Camera className="w-4 h-4 text-gray-400" />
          </button>
          <button className="p-2 hover:bg-[#252525] rounded-lg">
            <MessageSquare className="w-4 h-4 text-gray-400" />
          </button>
          <button className="p-2 hover:bg-[#252525] rounded-lg">
            <Maximize className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
