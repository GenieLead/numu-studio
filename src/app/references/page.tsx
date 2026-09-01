"use client";

import { useState } from "react";
import { 
  Search, 
  Filter, 
  Grid, 
  List, 
  Image, 
  Video, 
  Tag,
  Plus,
  MoreVertical,
  Trash2,
  Edit3,
  Copy
} from "lucide-react";

interface Reference {
  id: string;
  name: string;
  type: "product" | "character" | "location" | "visual style" | "other";
  thumbnail: string;
  tags: string[];
  usedIn: string[];
  createdAt: Date;
}

export default function ReferencesPage() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");

  const [references] = useState<Reference[]>([
    {
      id: "1",
      name: "NUMU Perfume Bottle",
      type: "product",
      thumbnail: "/api/placeholder/300/200",
      tags: ["perfume", "luxury", "bottle"],
      usedIn: ["NUMU Perfume - Test 02", "Desert Prism"],
      createdAt: new Date(),
    },
    {
      id: "2",
      name: "Falconer Character",
      type: "character",
      thumbnail: "/api/placeholder/300/200",
      tags: ["desert", "falconer", "traditional"],
      usedIn: ["NUMU Perfume - Test 02"],
      createdAt: new Date(),
    },
    {
      id: "3",
      name: "Desert Landscape",
      type: "location",
      thumbnail: "/api/placeholder/300/200",
      tags: ["desert", "sand", "sunset"],
      usedIn: ["NUMU Desert - Test 01", "NUMU Perfume - Test 02"],
      createdAt: new Date(),
    },
    {
      id: "4",
      name: "Guerlain Ad Reference",
      type: "visual style",
      thumbnail: "/api/placeholder/300/200",
      tags: ["perfume", "ad", "luxury"],
      usedIn: ["NUMU Perfume - Test 02"],
      createdAt: new Date(),
    },
    {
      id: "5",
      name: "ORIGIN Pen",
      type: "product",
      thumbnail: "/api/placeholder/300/200",
      tags: ["pen", "premium", "writing"],
      usedIn: ["The First Mark"],
      createdAt: new Date(),
    },
    {
      id: "6",
      name: "Walnut Desk",
      type: "location",
      thumbnail: "/api/placeholder/300/200",
      tags: ["desk", "wood", "office"],
      usedIn: ["The First Mark"],
      createdAt: new Date(),
    },
  ]);

  const filteredReferences = references.filter((ref) => {
    const matchesSearch = ref.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ref.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesFilter = filterType === "all" || ref.type === filterType;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="h-full bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-8 py-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Reference Library</h1>
            <p className="text-gray-500 mt-2">Your saved assets for reuse across productions</p>
          </div>
          <button className="flex items-center gap-2 px-6 py-3 bg-lime-500 hover:bg-lime-400 text-black font-semibold rounded-xl transition-colors">
            <Plus className="w-5 h-5" />
            Add Reference
          </button>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search references by name or tag..."
              className="w-full pl-12 pr-4 py-3 bg-[#111] border border-[#2a2a2a] rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-lime-500"
            />
          </div>
          
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-3 bg-[#111] border border-[#2a2a2a] rounded-xl text-white focus:outline-none focus:border-lime-500"
          >
            <option value="all">All Types</option>
            <option value="product">Products</option>
            <option value="character">Characters</option>
            <option value="location">Locations</option>
            <option value="visual style">Visual Styles</option>
          </select>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-3 rounded-xl transition-colors ${
                viewMode === "grid" ? "bg-[#1a1a1a] text-white" : "text-gray-500 hover:bg-[#111]"
              }`}
            >
              <Grid className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-3 rounded-xl transition-colors ${
                viewMode === "list" ? "bg-[#1a1a1a] text-white" : "text-gray-500 hover:bg-[#111]"
              }`}
            >
              <List className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* References Grid/List */}
        {viewMode === "grid" ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {filteredReferences.map((ref) => (
              <div
                key={ref.id}
                className="group bg-[#111] border border-[#2a2a2a] rounded-xl overflow-hidden hover:border-[#444] transition-all cursor-pointer"
              >
                <div className="aspect-video bg-[#1a1a1a] flex items-center justify-center relative">
                  <Image className="w-10 h-10 text-gray-600" />
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1 bg-black/60 rounded hover:bg-black/80">
                      <MoreVertical className="w-3 h-3 text-white" />
                    </button>
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-sm text-white truncate">{ref.name}</p>
                  <p className="text-xs text-lime-400 capitalize mt-1">{ref.type}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {ref.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="px-2 py-0.5 text-xs bg-[#252525] rounded text-gray-400">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredReferences.map((ref) => (
              <div
                key={ref.id}
                className="flex items-center gap-4 p-4 bg-[#111] border border-[#2a2a2a] rounded-xl hover:border-[#444] transition-all cursor-pointer"
              >
                <div className="w-20 h-14 bg-[#1a1a1a] rounded-lg flex items-center justify-center flex-shrink-0">
                  <Image className="w-8 h-8 text-gray-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium truncate">{ref.name}</p>
                  <p className="text-sm text-lime-400 capitalize">{ref.type}</p>
                </div>
                <div className="flex flex-wrap gap-1 max-w-xs">
                  {ref.tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 text-xs bg-[#252525] rounded text-gray-400">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="text-sm text-gray-500">
                  Used in {ref.usedIn.length} project{ref.usedIn.length !== 1 ? "s" : ""}
                </div>
                <div className="flex items-center gap-1">
                  <button className="p-2 hover:bg-[#252525] rounded-lg">
                    <Edit3 className="w-4 h-4 text-gray-400" />
                  </button>
                  <button className="p-2 hover:bg-[#252525] rounded-lg">
                    <Copy className="w-4 h-4 text-gray-400" />
                  </button>
                  <button className="p-2 hover:bg-[#252525] rounded-lg">
                    <Trash2 className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredReferences.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No references found</p>
          </div>
        )}
      </div>
    </div>
  );
}
