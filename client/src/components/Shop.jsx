import { useGameContext, GENERATOR_CONFIGS } from "../context/GameContext";

export function Shop() {
  const { state, dispatch } = useGameContext();

  const handleBuyGenerator = (generatorType) => {
    dispatch({
      type: "BUY_GENERATOR",
      payload: { generatorType },
    });
  };

  return (
    <div
      style={{
        marginTop: "1rem",
        borderRadius: "1rem",
        border: "1px solid #ccc",
        padding: "1rem",
      }}
    >
      <h2 style={{ marginTop: "0" }}>Hire Devs</h2>
      <p>
        Here you can hire developers to write LOC for you. It's a one time fee
        per developer, even though that doesn't make any sense. Don't pretend
        anything about software development makes sense; you pull that thread,
        no sweater.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "1rem",
        }}
      >
        {Object.entries(GENERATOR_CONFIGS).map(([generatorType, config]) => {
          const generator = state.generators[generatorType];
          const currentCost =
            config.baseCost * Math.pow(config.costMultiplier, generator.count);
          const canAfford = state.money >= currentCost;

          return (
            <div
              key={generatorType}
              style={{ border: "1px solid #999", padding: "10px" }}
            >
              <h3>{config.name}</h3>
              <p>Owned: {generator.count}</p>
              <p>Production: {config.locPerSecond} LOC/sec</p>
              <p>Cost: ${currentCost.toFixed(2)}</p>
              <button
                onClick={() => handleBuyGenerator(generatorType)}
                disabled={!canAfford}
                style={{
                  opacity: canAfford ? 1 : 0.5,
                  cursor: canAfford ? "pointer" : "not-allowed",
                }}
              >
                Hire 1 {config.name}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
