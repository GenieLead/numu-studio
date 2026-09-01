"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  Film, 
  Plus, 
  FolderOpen, 
  Settings, 
  User,
  ChevronLeft,
  Trash2,
  Edit3
} from "lucide-react";

interface Project {
  id: string;
  name: string;
  assetCount: number;
  lastModified: Date;
}

export function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [projects, setProjects] = useState<Project[]>([
    { id: "1", name: "Desert Prism", assetCount: 3, lastModified: new Date() },
    { id: "2", name: "NUMU Perfume - Test 02", assetCount: 6, lastModified: new Date() },
    { id: "3", name: "NUMU Desert - Test 01", assetCount: 3, lastModified: new Date() },
    { id: "4", name: "The First Mark", assetCount: 3, lastModified: new Date() },
  ]);

  const [selectedProject, setSelectedProject] = useState<string | null>("2");

  return (
    <aside className={`${isCollapsed ? 'w-16' : 'w-72'} bg-[#111111] border-r border-[#2a2a2a] flex flex-col transition-all duration-300`}>
      {/* Header */}
      <div className="p-4 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-lime-400 to-green-600 flex items-center justify-center">
            <Film className="w-5 h-5 text-black" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="font-bold text-white">HAYK</h1>
              <p className="text-xs text-gray-500">CREATIVE DIRECTOR</p>
            </div>
          )}
        </div>
      </div>

      {/* New Project Button */}
      <div className="p-4">
        <Link 
          href="/chat"
          className="flex items-center gap-3 px-4 py-3 bg-[#1a1a1a] hover:bg-[#252525] rounded-xl transition-colors group"
        >
          <Plus className="w-5 h-5 text-lime-400 group-hover:text-lime-300" />
          {!isCollapsed && <span className="text-gray-300">New project</span>}
        </Link>
      </div>

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto px-2">
        {!isCollapsed && (
          <p className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Project Folders
          </p>
        )}
        
        <div className="space-y-1">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => setSelectedProject(project.id)}
              className={`group flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-colors ${
                selectedProject === project.id 
                  ? 'bg-[#1a1a1a] border border-lime-500/30' 
                  : 'hover:bg-[#1a1a1a]'
              }`}
            >
              <FolderOpen className={`w-5 h-5 flex-shrink-0 ${
                selectedProject === project.id ? 'text-lime-400' : 'text-gray-500'
              }`} />
              
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${
                    selectedProject === project.id ? 'text-white' : 'text-gray-300'
                  }`}>
                    {project.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {project.assetCount} assets
                  </p>
                </div>
              )}
              
              {!isCollapsed && (
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                  <button className="p-1 hover:bg-[#333] rounded">
                    <Edit3 className="w-3 h-3 text-gray-400" />
                  </button>
                  <button className="p-1 hover:bg-[#333] rounded">
                    <Trash2 className="w-3 h-3 text-gray-400" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Section */}
      <div className="p-4 border-t border-[#2a2a2a] space-y-3">
        {/* Workspace Memory */}
        {!isCollapsed && (
          <div className="px-3 py-2 bg-[#1a1a1a] rounded-xl">
            <p className="text-xs text-gray-500 mb-2">Workspace memory</p>
            <p className="text-xs text-gray-400">
              Brand truth, products, audiences and approved assets will remain above every individual film.
            </p>
            <div className="flex gap-2 mt-2">
              <span className="px-2 py-1 text-xs bg-[#252525] rounded text-gray-400">Brand</span>
              <span className="px-2 py-1 text-xs bg-[#252525] rounded text-gray-400">Offer</span>
              <span className="px-2 py-1 text-xs bg-[#252525] rounded text-gray-400">Audience</span>
              <span className="px-2 py-1 text-xs bg-[#252525] rounded text-gray-400">Tone</span>
            </div>
          </div>
        )}

        {/* Profile */}
        <div className="flex items-center gap-3 px-3 py-2 hover:bg-[#1a1a1a] rounded-xl cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
          {!isCollapsed && (
            <div className="flex-1">
              <p className="text-sm text-white">Profile</p>
              <p className="text-xs text-gray-500">Settings & API</p>
            </div>
          )}
        </div>

        {/* Collapse Button */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full flex items-center justify-center p-2 hover:bg-[#1a1a1a] rounded-xl"
        >
          <ChevronLeft className={`w-5 h-5 text-gray-500 transition-transform ${isCollapsed ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </aside>
  );
}
