import { useGameContext } from "../context/useGameContext";
import { FREELANCE_PROJECTS_CONFIG } from "../context/gameConfig";
import { isFreelanceProjectUnlocked } from "../context/gameLogic";
import { releaseManagerAssignedCount } from "../../../shared/game-balance.js";
import { Button } from "./Button.jsx";

/**
 * Release Manager assignment selector (auto-ships).
 *
 * Each Release Manager is assigned to one freelance project and ships
 * one of it per ship interval, as long as there is LOC to cover the
 * cost. A manager with no assignment does nothing. Assignments are a
 * count per project (managers are fungible): the + / - buttons move
 * one manager at a time, and the total assigned can never exceed the
 * managers owned. Only unlocked projects are offered — a manager
 * cannot auto-ship a locked project. An assignment change is a
 * big-action save trigger, so it persists promptly.
 *
 * Rendered under the Release Manager card in the Shop, only while the
 * type is unlocked and at least one manager is owned (with zero
 * managers there is nothing to assign).
 */
export function ReleaseManagerAssignments() {
  const { state, dispatch } = useGameContext();
  const owned = state.employees.releaseManager?.count ?? 0;
  const assignments = state.releaseManagerAssignments ?? {};
  const totalAssigned = releaseManagerAssignedCount(assignments);
  const unassigned = owned - totalAssigned;

  if (owned <= 0) return null;

  const setAssignment = (projectKey, count) => {
    dispatch({
      type: "SET_RELEASE_MANAGER_ASSIGNMENT",
      payload: { projectKey, count },
    });
  };

  return (
    <div className="panel px-3 py-2 flex flex-col gap-1 m-0">
      <div className="text-sm font-semibold">
        Assignments — {totalAssigned} assigned, {unassigned} unassigned
      </div>
      <div className="text-xs text-gray-400">
        Each assigned manager ships one of its project every minute, as
        long as there is LOC to cover the cost.
      </div>
      {Object.entries(FREELANCE_PROJECTS_CONFIG).map(
        ([projectKey, project]) => {
          if (!isFreelanceProjectUnlocked(projectKey, state)) return null;
          const count = assignments[projectKey] ?? 0;
          return (
            <div
              key={projectKey}
              className="flex items-center gap-2 text-sm"
            >
              <span className="flex-1">{project.name}</span>
              <Button
                onClick={() => setAssignment(projectKey, count - 1)}
                disabled={count <= 0}
                className={count <= 0 ? "game-button--inactive" : ""}
                aria-label={`Unassign a manager from ${project.name}`}
              >
                −
              </Button>
              <span className="w-6 text-center" aria-label={`${project.name} assigned managers`}>
                {count}
              </span>
              <Button
                onClick={() => setAssignment(projectKey, count + 1)}
                disabled={unassigned <= 0}
                className={unassigned <= 0 ? "game-button--inactive" : ""}
                aria-label={`Assign a manager to ${project.name}`}
              >
                +
              </Button>
            </div>
          );
        }
      )}
    </div>
  );
}
