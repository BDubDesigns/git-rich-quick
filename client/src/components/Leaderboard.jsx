import { useCallback, useEffect, useState } from "react";
import { SectionLayout } from "./SectionLayout.jsx";
import { Button } from "./Button.jsx";
import { SAVE_API_URL, getLeaderboard } from "../save/api.js";

/**
 * Leaderboard (issue #29): the top 10 ACCOUNTS only (guests never
 * appear), ranked by lifetime LOC by default. The sort switcher offers
 * Lifetime LOC (default), Current LOC, and Cash; switching re-fetches
 * from the server so the top 10 is correct for that sort. Scores come
 * from the server live on each load — a player's score updates when
 * they save. Money is stored in cents and shown as dollars; LOC is
 * shown floored (it can be fractional from passive rates).
 */

const SORTS = [
  { id: "lifetime", label: "Lifetime LOC" },
  { id: "current", label: "Current LOC" },
  { id: "cash", label: "Cash" },
];

function formatScore(sort, entry) {
  if (sort === "cash") {
    return `$${(entry.money / 100).toFixed(2)}`;
  }
  const value = sort === "current" ? entry.currentLoc : entry.lifetimeLoc;
  return `${Math.floor(value).toLocaleString()} LOC`;
}

export function Leaderboard() {
  const [sort, setSort] = useState("lifetime");
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);

  const fetchBoard = useCallback(async (sortId) => {
    setError(null);
    try {
      const { status, data } = await getLeaderboard(SAVE_API_URL, sortId);
      if (status !== 200 || !data || !Array.isArray(data.entries)) {
        setError("Could not load the leaderboard.");
        setEntries([]);
        return;
      }
      setEntries(data.entries);
    } catch {
      setError("Could not load the leaderboard.");
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    fetchBoard(sort);
  }, [sort, fetchBoard]);

  return (
    <SectionLayout sectionId="leaderboard">
      <div className="flex gap-2 flex-wrap">
        {SORTS.map(({ id, label }) => (
          <Button
            key={id}
            onClick={() => setSort(id)}
            className={sort === id ? "" : "game-button--inactive"}
          >
            {label}
          </Button>
        ))}
      </div>
      {error && <p className="primary-text">{error}</p>}
      {entries === null && <p className="primary-text">Loading…</p>}
      {entries !== null && entries.length === 0 && !error && (
        <p className="primary-text">
          No accounts on the board yet. Link a save to an account and
          write some LOC to claim a spot.
        </p>
      )}
      {entries !== null && entries.length > 0 && (
        <div className="panel flex flex-col gap-1">
          {entries.map((entry) => (
            <div
              key={entry.rank}
              className="flex items-center gap-3 px-2 py-1"
            >
              <span className="w-6 text-right font-bold">{entry.rank}.</span>
              <span className="flex-1 truncate">{entry.displayName}</span>
              <span className="font-bold">{formatScore(sort, entry)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionLayout>
  );
}
