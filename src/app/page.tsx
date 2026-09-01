"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  Plus, 
  Film, 
  Image, 
  Video, 
  Clock,
  MoreVertical,
  Trash2,
  Edit3,
  Copy
} from "lucide-react";

interface Asset {
  id: string;
  name: string;
  type: "image" | "video";
  thumbnail: string;
  createdAt: Date;
}

interface Project {
  id: string;
  name: string;
  description: string;
  assets: Asset[];
  lastModified: Date;
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"projects" | "assets">("projects");
  
  const [projects] = useState<Project[]>([
    {
      id: "1",
      name: "Desert Prism",
      description: "Cinematic luxury perfume film",
      assets: [
        { id: "a1", name: "product reference.jpeg", type: "image", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a2", name: "perfume reference Ad.mp4", type: "video", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a3", name: "Character reference.jpg", type: "image", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
      ],
      lastModified: new Date(),
    },
    {
      id: "2",
      name: "NUMU Perfume - Test 02",
      description: "8-second vertical luxury perfume film",
      assets: [
        { id: "a4", name: "product reference.jpeg", type: "image", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a5", name: "perfume reference Ad.mp4", type: "video", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a6", name: "Character reference.jpg", type: "image", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a7", name: "desert landscape.jpg", type: "image", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a8", name: "final shot 01.mp4", type: "video", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a9", name: "final shot 02.mp4", type: "video", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
      ],
      lastModified: new Date(),
    },
    {
      id: "3",
      name: "NUMU Desert - Test 01",
      description: "Desert cinematic test",
      assets: [
        { id: "a10", name: "desert reference.jpg", type: "image", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a11", name: "model reference.jpg", type: "image", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a12", name: "AI evidence.mp4", type: "video", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
      ],
      lastModified: new Date(),
    },
    {
      id: "4",
      name: "The First Mark",
      description: "Origin pen opening scene",
      assets: [
        { id: "a13", name: "pen reference.jpg", type: "image", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a14", name: "desk reference.jpg", type: "image", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
        { id: "a15", name: "AI evidence.mp4", type: "video", thumbnail: "/api/placeholder/300/200", createdAt: new Date() },
      ],
      lastModified: new Date(),
    },
  ]);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <header className="px-8 py-6 border-b border-[#2a2a2a]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Creative Room</h1>
            <p className="text-gray-500 mt-1">Your cinematic production studio</p>
          </div>
          <Link
            href="/chat"
            className="flex items-center gap-2 px-6 py-3 bg-lime-500 hover:bg-lime-400 text-black font-semibold rounded-xl transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Production
          </Link>
        </div>
      </header>

      {/* Tabs */}
      <div className="px-8 py-4 border-b border-[#2a2a2a]">
        <div className="flex gap-6">
          <button
            onClick={() => setActiveTab("projects")}
            className={`pb-2 font-medium transition-colors ${
              activeTab === "projects" 
                ? "text-lime-400 border-b-2 border-lime-400" 
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            Projects
          </button>
          <button
            onClick={() => setActiveTab("assets")}
            className={`pb-2 font-medium transition-colors ${
              activeTab === "assets" 
                ? "text-lime-400 border-b-2 border-lime-400" 
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            All Assets
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        {activeTab === "projects" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {/* New Project Card */}
            <Link
              href="/chat"
              className="group flex flex-col items-center justify-center p-8 border-2 border-dashed border-[#333] rounded-2xl hover:border-lime-500/50 hover:bg-[#111] transition-all cursor-pointer"
            >
              <div className="w-16 h-16 rounded-2xl bg-[#1a1a1a] group-hover:bg-lime-500/10 flex items-center justify-center mb-4 transition-colors">
                <Plus className="w-8 h-8 text-gray-500 group-hover:text-lime-400 transition-colors" />
              </div>
              <p className="text-gray-400 group-hover:text-white transition-colors">Start new production</p>
            </Link>

            {/* Project Cards */}
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/chat?project=${project.id}`}
                className="group bg-[#111] border border-[#2a2a2a] rounded-2xl overflow-hidden hover:border-[#444] transition-all"
              >
                {/* Thumbnail Grid */}
                <div className="grid grid-cols-2 gap-1 p-2">
                  {project.assets.slice(0, 4).map((asset, i) => (
                    <div
                      key={asset.id}
                      className={`relative overflow-hidden rounded-lg ${
                        project.assets.length > 4 && i === 3 ? "col-span-2" : ""
                      }`}
                    >
                      <div className="aspect-video bg-[#1a1a1a] flex items-center justify-center">
                        {asset.type === "video" ? (
                          <Video className="w-8 h-8 text-gray-600" />
                        ) : (
                          <Image className="w-8 h-8 text-gray-600" />
                        )}
                      </div>
                      {project.assets.length > 4 && i === 3 && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <span className="text-white font-medium">+{project.assets.length - 4}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Project Info */}
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-white group-hover:text-lime-400 transition-colors">
                        {project.name}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">{project.description}</p>
                    </div>
                    <button className="p-1 hover:bg-[#2a2a2a] rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreVertical className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Film className="w-3 h-3" />
                      {project.assets.length} assets
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {project.lastModified.toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          /* All Assets View */
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {projects.flatMap(p => p.assets).map((asset) => (
              <div
                key={asset.id}
                className="group bg-[#111] border border-[#2a2a2a] rounded-xl overflow-hidden hover:border-[#444] transition-all cursor-pointer"
              >
                <div className="aspect-video bg-[#1a1a1a] flex items-center justify-center relative">
                  {asset.type === "video" ? (
                    <Video className="w-10 h-10 text-gray-600" />
                  ) : (
                    <Image className="w-10 h-10 text-gray-600" />
                  )}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1 bg-black/60 rounded hover:bg-black/80">
                      <MoreVertical className="w-3 h-3 text-white" />
                    </button>
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-xs text-white truncate">{asset.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{asset.type}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
