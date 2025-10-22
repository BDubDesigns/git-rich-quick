# Git Rich Quick: The Complete Development Plan

This document outlines the full, pragmatic development plan for building the "Git Rich Quick" game. It follows the MERN stack architecture, prioritizing achievable phases and using the established **config + state separation pattern** that keeps code clean and balancing easy.

## Guiding Principles

- **Phase-Based Approach:** We build the game in logical, distinct phases. Do not move to the next phase until the current one is complete and working.

- **Config + State Separation:** All game balance data (costs, multipliers, production rates) lives in immutable config objects. State stores only counts and currencies. This keeps the reducer clean and makes balancing easy.

- **Client First:** The entire game is built and perfected on the client-side first. This ensures core gameplay is fun before adding backend complexity.

- **Pragmatic Security:** We demonstrate full-stack competence with a "Server-Side Sanity Check" that validates game progression without making the system un-hackable.

---

## The Architecture Pattern

### Configuration Objects (Immutable)

These define all game balance data and are exported for use in components:

```javascript
export const GENERATOR_CONFIGS = {
  intern: {
    name: "Intern",
    baseCost: 10,
    locPerSecond: 1,
    costMultiplier: 1.1,
  },
  // ... more generators
};
```

### State (Counts + Currencies Only)

State stores only the player's current numbers, never the config:

```javascript
const initialState = {
  linesOfCode: 0,
  money: 0,
  generators: {
    intern: { count: 0 },
    junior: { count: 0 },
    senior: { count: 0 },
  },
  // ... more state
};
```

### Dynamic Calculations in Components and Reducer

Cost, production, and other values are calculated at runtime:

```javascript
const currentCost =
  config.baseCost * Math.pow(config.costMultiplier, generator.count);
```

---

## Phase 1: The Single-Player Prototype (Client-Side)

**Goal:** Build a complete, functional, and fun single-player game. At the end, the game works perfectly but resets on page refresh.

**Tech Stack:** React, Vite, useContext/useReducer

### Deliverables

1. ✅ **GameContext.jsx** with:

   - Immutable config objects (`GENERATOR_CONFIGS`, `AI_ASSISTANT_CONFIGS`)
   - Clean initial state with counts only
   - Reducer with actions: `WRITE_CODE`, `BUY_GENERATOR`, `COMPLETE_PROJECT`, `GAME_TICK`
   - `GameProvider` component and `useGameContext` hook

2. ✅ **Core Components:**

   - `Header`: Display LOC and Money
   - `ClickButton`: +10 LOC per click
   - `Shop`: Buy generators with increasing costs
   - `Projects`: Convert LOC to Money

3. ✅ **Game Loop:**

   - `useEffect` in App.jsx dispatches `GAME_TICK` every 1 second
   - `GAME_TICK` generates passive LOC based on owned generators

4. **Next (Optional for Phase 1):**
   - `OpenSource`: Donate LOC to build community trust
   - `AIShop`: Buy NoPilot and CodeRaccoon seats
   - Styling and polish

### How to Build Phase 1

See `phase_one_outline.md` for step-by-step instructions with code examples.

---

## Phase 2: The Core Backend (Server-Side Foundation)

**Goal:** Set up Node.js server and database. Build essential user authentication and a simple save/load system.

**Tech Stack:** Node.js, Express, MongoDB, Mongoose, JWT, bcryptjs

### Deliverables

1. **Server Setup:**

   - Express server running on `/api`
   - MongoDB Atlas connection
   - Environment variables (.env)

2. **User Authentication API:**

   - `POST /api/auth/register`: Hash password, create user
   - `POST /api/auth/login`: Validate password, return JWT
   - Both store `username`, hashed `password`, `gameState` object

3. **Simple Save/Load API:**
   - `GET /api/game/state` (protected): Return user's `gameState`
   - `POST /api/game/state` (protected): Save entire `gameState` (no validation yet)

### How to Build Phase 2

1. Create `/server` directory at project root
2. Install dependencies: `express`, `mongoose`, `jsonwebtoken`, `bcryptjs`, `cors`, `dotenv`
3. Set up `.env` with `MONGO_URI` and `JWT_SECRET`
4. Create `User` schema with `username`, `password`, `gameState` fields
5. Build auth routes with bcrypt hashing and JWT tokens
6. Build game routes with basic save/load (no validation)

---

## Phase 3: The Full-Stack Integration

**Goal:** Connect the React game to backend services, turning it into a persistent online experience.

**Tech Stack:** React, React Router, Fetch API

### Deliverables

1. **Auth Pages in React:**

   - `LoginPage.jsx`: Form to log in
   - `RegisterPage.jsx`: Form to register
   - Store JWT in `localStorage`

2. **Protected Game View:**

   - Redirect to login if no JWT
   - Load game state from `/api/game/state` on login

3. **Auto-Save System:**
   - `useEffect` in App.jsx saves entire game state to `/api/game/state` every 60 seconds
   - Include JWT in `Authorization` header for all protected requests

### How to Build Phase 3

1. Install `react-router-dom`
2. Set up routing with protected routes
3. Create login/register pages
4. Add JWT to `localStorage` after login
5. Load initial state from `/api/game/state` into reducer
6. Add auto-save `useEffect` that POSTs state every 60 seconds

---

## Phase 4: The "Security" Layer (Server-Side Refinement)

**Goal:** Make the save system smarter to mitigate cheating.

**Tech Stack:** Express logic

### The "Sanity Check" Algorithm

When server receives a save request:

1. Fetch the user's **currently saved (old) state** from database
2. Calculate `time_passed` since last save (seconds)
3. Calculate `max_realistic_gain` based on:
   - Old state's generator counts
   - Each generator's production rate
   - A generous "clicks per second" limit (e.g., 100)
4. Compare `actual_gain` (from new state) vs `max_realistic_gain`
5. If actual > max × 1.5 (generous margin), return `403 Forbidden`
6. Otherwise, save the new state

### Example

```javascript
const maxRealisticLOC =
  (interns * 1 + juniors * 5 + seniors * 20) * timePassed + 100 * timePassed;
const actualLOC = newState.linesOfCode - oldState.linesOfCode;
if (actualLOC > maxRealisticLOC * 1.5) {
  return res.status(403).json({ error: "Unrealistic gain detected" });
}
```

This catches obvious cheaters without requiring complex server-side game logic.

### How to Build Phase 4

1. Modify `POST /api/game/state` to fetch old state first
2. Implement sanity check algorithm
3. Return 403 if cheating is detected
4. Otherwise proceed with save

---

## Phase 5: The "Social" Layer (Full-Stack Real-time)

**Goal:** Add live, global chat feature.

**Tech Stack:** Socket.io

### Deliverables

1. **Backend Socket.io Setup:**

   - Wrap Express server with Socket.io
   - Listen for `chat message` events
   - Broadcast to all clients

2. **Frontend Socket.io Integration:**

   - Connect to Socket.io server
   - Display incoming messages
   - Send messages when user types

3. **Chat Component:**
   - `Chat.jsx` with message display and input form
   - Shows all players' messages in real-time

### How to Build Phase 5

1. Install `socket.io` on server and `socket.io-client` on client
2. Wrap Express with `io()`
3. Handle `connection`, `disconnect`, and `chat message` events
4. Create `Chat.jsx` component with Socket.io integration
5. Display all messages in real-time

---

## Phase 6: Content, Polish & End-Game

**Goal:** Add final gameplay features and polish. These can be done in any order.

### Features to Add

1. **Open Source System** (Phase 1 extended):

   - Donate LOC to open source projects
   - Build community trust (0-100)
   - Community trust affects other game mechanics

2. **AI Shop** (Phase 1 extended):

   - Buy NoPilot and CodeRaccoon seats
   - Shared seat pool: `noPilotSeats + raccoonSeats <= totalDevs`
   - CodeRaccoon cost decreases per seat (diminishing returns)

3. **Crypto Farm Minigame**:

   - Buy mining rigs (new generator type)
   - Cryptocurrency wallet with price fluctuation
   - Risky/high-reward playstyle

4. **News Ticker**:

   - Scrolling CSS animation at top/bottom of screen
   - Funny, satirical headlines
   - No gameplay impact (flavor only)

5. **Leaderboard**:

   - `GET /api/leaderboard`: Top 100 players by money/LOC/whatever
   - Display in React component
   - Update on page load

6. **Ascension (Prestige)**:
   - `RESET_GAME` action resets most state but keeps "Industry Clout"
   - Clout multiplies all gains (2x on first ascension, 3x on second, etc.)
   - Players reset strategically to grow faster

### How to Build Phase 6

- Each feature can be built independently
- All follow the same pattern: config + state + components
- Integrate features one at a time, test thoroughly
- Balance is key: tweak multipliers and costs until progression feels right

---

## Development Workflow

### Recommended Order

**Session 1:** Setup + Basic Components

- Parts 1-3 of phase_one_outline.md
- Result: Click button works, displays LOC and money

**Session 2:** Game Loop + Generators

- Parts 4-5 of phase_one_outline.md
- Result: Generators passively produce LOC, can buy them

**Session 3:** Projects + Full Loop

- Parts 6-7 of phase_one_outline.md
- Result: Complete game loop works (Click → Buy → Generate → Convert → Repeat)

**Session 4:** Polish + Optional Features

- Add styling
- Add Open Source or AI Shop
- Game balance pass

**Session 5+:** Backend (Phase 2+)

- Set up server, auth, save/load
- Connect frontend to backend
- Add validation and security

### Testing After Each Feature

- Does the feature work as expected?
- Are there console errors?
- Does the game feel balanced?
- Is the progression rewarding?

---

## File Structure

```
git-rich-quick/
├── src/
│   ├── context/
│   │   └── GameContext.jsx          # Config objects, state, reducer, provider, hook
│   ├── components/
│   │   ├── Header.jsx               # Display LOC and Money
│   │   ├── ClickButton.jsx          # +10 LOC per click
│   │   ├── Shop.jsx                 # Buy generators
│   │   ├── Projects.jsx             # Complete projects for money
│   │   ├── OpenSource.jsx           # (Phase 1 extended)
│   │   ├── AIShop.jsx               # (Phase 1 extended)
│   │   ├── Chat.jsx                 # (Phase 5)
│   │   └── Leaderboard.jsx          # (Phase 6)
│   ├── pages/
│   │   ├── LoginPage.jsx            # (Phase 3)
│   │   ├── RegisterPage.jsx         # (Phase 3)
│   │   └── GamePage.jsx             # (Phase 3)
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── index.html
├── vite.config.js
├── package.json
└── phase_one_outline.md             # Step-by-step building guide
```

---

## Key Concepts

### Config + State Separation

**Why?**

- Keeps reducer pure and simple
- Makes balancing easy (change one number in config)
- Prevents state drift (config is always source of truth)
- Components can loop through config to render UI

**Example:** To buff all generators by 50%, just multiply `baseCost` and `locPerSecond` by 1.5 in the config. No state changes needed.

### Dynamic Cost Formula

```javascript
const currentCost = config.baseCost * Math.pow(config.costMultiplier, count);
```

- Cost increases exponentially with each purchase
- Prevents early-game from feeling trivial
- Late-game feels like progression (each purchase is harder)
- Configurable: tweak `costMultiplier` to balance pacing

### Game Loop Pattern

```javascript
useEffect(() => {
  const interval = setInterval(() => {
    dispatch({ type: "GAME_TICK" });
  }, 1000);
  return () => clearInterval(interval);
}, [dispatch]);
```

- Runs every second (1000ms)
- Dispatches passive income logic
- Cleanup function prevents memory leaks
- Central place for time-based calculations

---

## Balance Tips

### Early Game (First 5-10 Minutes)

- Clicking should feel good
- First generators should be cheap
- Progression should feel fast

### Mid Game (10-60 Minutes)

- Generators become primary income
- Projects convert LOC to money efficiently
- New generators become available

### Late Game (60+ Minutes)

- Costs are high; progression is slower
- Prestige system becomes relevant
- Leaderboard competition kicks in

### General Tuning

- If game feels too easy: increase all `baseCost` values
- If game feels too slow: decrease all `costMultiplier` values
- If early game is boring: make first generators cheaper
- If late game is grindy: add new generator tiers or prestige bonuses

---

## Next Steps

1. Read `phase_one_outline.md` for detailed step-by-step instructions
2. Build Phase 1 completely before moving to Phase 2
3. Test thoroughly after each feature
4. Balance game by playing through multiple runs
5. When ready, move to backend integration (Phase 2+)

Good luck! This is going to be awesome. 🚀
