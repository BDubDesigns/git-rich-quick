import {
  useGameContext,
  FREELANCE_PROJECTS_CONFIG,
} from "../context/GameContext";

export function Projects() {
  const { state, dispatch } = useGameContext();

  const handleCompleteProject = (projectKey) => {
    dispatch({
      type: "COMPLETE_PROJECT",
      payload: { projectKey },
    });
  };

  return (
    <div
      style={{
        marginTop: "1rem",
        border: "1px solid #ccc",
        padding: "1rem",
        borderRadius: "1rem",
      }}
    >
      <h2 style={{ marginTop: "0" }}>Freelance Projects</h2>
      <p>Convert LOC to Money by completing projects</p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "1rem",
        }}
      >
        {Object.entries(FREELANCE_PROJECTS_CONFIG).map(
          ([projectKey, project]) => {
            const canComplete = state.linesOfCode >= project.loc;

            return (
              <div
                key={projectKey}
                style={{ border: "1px solid #999", padding: "1rem" }}
              >
                <h3>{project.name}</h3>
                <p>{project.description}</p>
                <p>Requires: {project.loc} LOC</p>
                <p>Reward: ${project.reward}</p>
                <button
                  onClick={() => handleCompleteProject(projectKey)}
                  disabled={!canComplete}
                  style={{
                    opacity: canComplete ? 1 : 0.5,
                    cursor: canComplete ? "pointer" : "not-allowed",
                  }}
                >
                  Complete Project
                </button>
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}
