import {
  useGameContext,
  FREELANCE_PROJECTS_CONFIG,
} from "../context/GameContext";
import { formatMoney } from "../utils/currency.js";
import { ActionButton } from "./ActionButton.jsx";

export function Projects() {
  const { state, dispatch } = useGameContext();

  const handleCompleteProject = (projectKey) => {
    dispatch({
      type: "COMPLETE_PROJECT",
      payload: { projectKey },
    });
  };

  return (
    <div className="mt-4 border border-gray-300 p-4 rounded-2xl">
      <h2 className="mt-0">Freelance Projects</h2>
      <p>Convert LOC to Money by completing projects</p>
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(FREELANCE_PROJECTS_CONFIG).map(
          ([projectKey, project]) => {
            const canComplete = state.linesOfCode >= project.loc;

            return (
              <div
                key={projectKey}
                className="border rounded-md border-gray-300 p-4 flex flex-col"
              >
                <h3>{project.name}</h3>
                <p>{project.description}</p>
                <p>Requires: {project.loc} LOC</p>
                <p>Reward: ${formatMoney(project.reward)}</p>
                <ActionButton
                  onClick={() => handleCompleteProject(projectKey)}
                  disabled={!canComplete}
                  floatText={`$${formatMoney(project.reward)}`}
                >
                  Ship Project
                </ActionButton>
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}
