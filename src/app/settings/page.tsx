"use client";

import { useState } from "react";
import { 
  Key, 
  Save, 
  Eye, 
  EyeOff, 
  CheckCircle,
  AlertCircle,
  CreditCard,
  Activity
} from "lucide-react";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  const handleSave = async () => {
    setIsSaving(true);
    // Simulate save
    setTimeout(() => {
      setIsSaving(false);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }, 1000);
  };

  return (
    <div className="h-full bg-[#0a0a0a]">
      <div className="max-w-3xl mx-auto px-8 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-gray-500 mt-2">Configure your NUMU Studio</p>
        </div>

        {/* API Configuration */}
        <div className="bg-[#111] border border-[#2a2a2a] rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-lime-500/10 flex items-center justify-center">
              <Key className="w-5 h-5 text-lime-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">API Configuration</h2>
              <p className="text-sm text-gray-500">Connect to OpenRouter for AI generation</p>
            </div>
          </div>

          <div className="space-y-4">
            {/* OpenRouter API Key */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                OpenRouter API Key
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full px-4 py-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-lime-500 pr-12"
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-[#252525] rounded"
                >
                  {showApiKey ? (
                    <EyeOff className="w-5 h-5 text-gray-500" />
                  ) : (
                    <Eye className="w-5 h-5 text-gray-500" />
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-600">
                Get your API key from{" "}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-lime-400 hover:text-lime-300"
                >
                  openrouter.ai/keys
                </a>
              </p>
            </div>

            {/* Save Button */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-3 bg-lime-500 hover:bg-lime-400 disabled:bg-[#252525] text-black font-semibold rounded-xl transition-colors"
              >
                {isSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>

              {saveStatus === "success" && (
                <span className="flex items-center gap-2 text-sm text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  Saved successfully
                </span>
              )}
              {saveStatus === "error" && (
                <span className="flex items-center gap-2 text-sm text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  Error saving
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Usage Stats */}
        <div className="bg-[#111] border border-[#2a2a2a] rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Usage</h2>
              <p className="text-sm text-gray-500">Track your API usage and spending</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-[#1a1a1a] rounded-xl">
              <p className="text-sm text-gray-500">Total Spent</p>
              <p className="text-2xl font-bold text-white mt-1">$0.00</p>
            </div>
            <div className="p-4 bg-[#1a1a1a] rounded-xl">
              <p className="text-sm text-gray-500">Images Generated</p>
              <p className="text-2xl font-bold text-white mt-1">0</p>
            </div>
            <div className="p-4 bg-[#1a1a1a] rounded-xl">
              <p className="text-sm text-gray-500">Videos Generated</p>
              <p className="text-2xl font-bold text-white mt-1">0</p>
            </div>
          </div>
        </div>

        {/* Billing */}
        <div className="bg-[#111] border border-[#2a2a2a] rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Billing</h2>
              <p className="text-sm text-gray-500">Manage your OpenRouter credits</p>
            </div>
          </div>

          <div className="p-4 bg-[#1a1a1a] rounded-xl">
            <p className="text-sm text-gray-500">Current Balance</p>
            <p className="text-2xl font-bold text-white mt-1">$5.00</p>
            <a
              href="https://openrouter.ai/credits"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 px-4 py-2 bg-[#252525] hover:bg-[#333] rounded-lg text-sm text-gray-300 transition-colors"
            >
              Add Credits
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
