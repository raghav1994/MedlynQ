"use client";

import { useEffect, useState } from "react";

type ConnectionInfo = {
  device: string;
  role: string;
  ip: string;
  timestamp: string;
};

export default function MobileConnectionCard() {
  const [ips, setIps] = useState<string[]>(["127.0.0.1"]);
  const [activeIp, setActiveIp] = useState("127.0.0.1");
  const [lastConnected, setLastConnected] = useState<ConnectionInfo | null>(null);
  const [isLinked, setIsLinked] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchConnection = async () => {
    try {
      const res = await fetch("/api/ping");
      if (res.ok) {
        const data = await res.json();
        const detectedIps = data.ips || [data.ip || "127.0.0.1"];
        setIps(detectedIps);
        setLastConnected(data.lastConnected);

        // Prioritize Wi-Fi subnets starting with 192.168.
        const wifiIp = detectedIps.find((item: string) => item.startsWith("192.168."));
        setActiveIp(wifiIp || detectedIps[0]);

        if (data.lastConnected?.timestamp) {
          const lastTime = new Date(data.lastConnected.timestamp).getTime();
          const now = new Date().getTime();
          // Active if pinged in the last 60 seconds
          setIsLinked(now - lastTime < 60000);
        } else {
          setIsLinked(false);
        }
      }
    } catch (e) {
      console.error("Failed to fetch connection status", e);
    }
  };

  useEffect(() => {
    fetchConnection();
    const interval = setInterval(fetchConnection, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-5 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        {/* Connection status and info */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-ink-100 flex items-center gap-1.5">
              📱 MedLynq Cam Local Link
            </span>
            <div
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
                isLinked
                  ? "bg-good/10 text-good border border-good/20"
                  : "bg-warn/10 text-warn border border-warn/20"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
              {isLinked ? "Linked & Syncing" : "Awaiting Mobile App"}
            </div>
          </div>
          <p className="text-xs text-ink-300 max-w-xl">
            Upload captured patient documents and dictate voice notes directly from your smartphone.
          </p>
        </div>

        {/* IP display and copy helper */}
        <div className="flex flex-col gap-1.5 self-start md:self-auto">
          <div className="text-[9px] uppercase font-bold text-ink-400">Desktop Server IPs (Select / Click to Copy)</div>
          <div className="flex flex-wrap gap-2">
            {ips.map((item) => {
              const isRecommended = item.startsWith("192.168.") || item.startsWith("172.");
              return (
                <div
                  key={item}
                  onClick={() => {
                    navigator.clipboard.writeText(item);
                    setActiveIp(item);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs cursor-pointer transition select-none ${
                    activeIp === item
                      ? "bg-accent-soft text-accent border-accent font-semibold"
                      : "bg-bone-200 text-ink-200 border-bone-300 hover:bg-bone-300"
                  }`}
                >
                  <code>{item}</code>
                  {isRecommended && (
                    <span className="bg-good/15 text-good px-1 rounded-[3px] text-[8px] font-bold uppercase">
                      Wi-Fi
                    </span>
                  )}
                  <span className="text-[10px] opacity-75">📋</span>
                </div>
              );
            })}
          </div>
          {copied && <span className="text-[9px] text-good font-semibold animate-pulse mt-0.5">IP Copied: {activeIp}</span>}
        </div>
      </div>

      <hr className="my-4 border-bone-300" />

      {/* Guide steps and status detail */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-ink-200">
        <div>
          <h4 className="font-bold text-ink-100 mb-2">How to Link Your Device:</h4>
          <ol className="list-decimal pl-4 space-y-1 text-ink-300">
            <li>Ensure your computer and mobile phone are on the <strong>same Wi-Fi network</strong>.</li>
            <li>Open the <strong>MedLynq Cam</strong> app on your smartphone.</li>
            <li>Enter the Desktop Server IP shown above (<strong>{activeIp}</strong>) in the connection field.</li>
            <li>Click <strong>Test Connection</strong> or <strong>Sign In</strong> to complete the link.</li>
          </ol>
        </div>

        <div className="flex flex-col justify-center bg-bone-100/50 p-3 rounded border border-dashed border-bone-300">
          <h4 className="font-bold text-ink-100 mb-1.5">Last Connected Device:</h4>
          {lastConnected ? (
            <div className="space-y-1 text-ink-300">
              <div>Device: <strong className="text-ink-100">{lastConnected.device}</strong></div>
              <div>Role: <strong className="text-ink-100">{lastConnected.role}</strong></div>
              <div>Last Ping: <span className="italic">{new Date(lastConnected.timestamp).toLocaleTimeString()}</span></div>
              <div className="text-[10px] text-good font-semibold mt-1">✓ Connection is verified and listening on port 3000.</div>
            </div>
          ) : (
            <div className="text-ink-400 italic">No device connected yet. Please follow the instructions to link your phone.</div>
          )}
        </div>
      </div>
    </div>
  );
}
