import type { AuthType } from "../types";

interface AuthPanelProps {
  authType: AuthType;
  onAuthTypeChange: (t: AuthType) => void;
  bearerToken: string;
  onBearerTokenChange: (t: string) => void;
  editingCollectionName: string | null;
}

const AUTH_OPTIONS: { value: AuthType; label: string }[] = [
  { value: "none", label: "No Auth" },
  { value: "inherit", label: "Inherit from collection" },
  { value: "bearer", label: "Bearer Token" },
];

export default function AuthPanel({
  authType,
  onAuthTypeChange,
  bearerToken,
  onBearerTokenChange,
  editingCollectionName,
}: AuthPanelProps) {
  return (
    <div className="p-3 space-y-3">
      {/* Auth Type Selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-pulse-text-secondary w-16">
          Type
        </label>
        <select
          value={authType}
          onChange={(e) => onAuthTypeChange(e.target.value as AuthType)}
          className="bg-pulse-deepest border border-pulse-border rounded px-2 py-1.5 text-xs font-mono text-pulse-text-primary cursor-pointer transition-colors"
        >
          {AUTH_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Inherit info */}
      {authType === "inherit" && (
        <div className="pl-[5.5rem]">
          {editingCollectionName ? (
            <p className="text-[11px] text-pulse-text-muted">
              Using auth from{" "}
              <span className="text-pulse-accent font-medium">
                {editingCollectionName}
              </span>
            </p>
          ) : (
            <p className="text-[11px] text-pulse-amber">
              This request is not saved in a collection. Inherit will fall back to No Auth.
            </p>
          )}
        </div>
      )}

      {/* Bearer Token Input */}
      {authType === "bearer" && (
        <>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-pulse-text-secondary w-16">
              Token
            </label>
            <input
              type="text"
              value={bearerToken}
              onChange={(e) => onBearerTokenChange(e.target.value)}
              placeholder="Enter your bearer token..."
              className="flex-1 bg-pulse-deepest border border-pulse-border rounded px-2 py-1.5 text-xs font-mono text-pulse-text-primary placeholder-pulse-text-muted/50 transition-colors"
            />
          </div>
          {bearerToken.trim() && (
            <p className="text-[11px] text-pulse-text-muted pl-[5.5rem]">
              Will be sent as:{" "}
              <code className="text-pulse-accent">
                Authorization: Bearer{" "}
                {bearerToken.trim().replace(/^Bearer\s+/i, "")}
              </code>
            </p>
          )}
        </>
      )}
    </div>
  );
}
