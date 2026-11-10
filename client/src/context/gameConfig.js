/**
 * Game configuration — the single source of truth for display data.
 *
 * All game balance numbers come from `shared/game-balance.js` (also read
 * by the save server, so a number typed here and a number typed there
 * would drift). This file only adds display data (names, icons,
 * descriptions) on top of them.
 *
 * Configs are immutable (`Object.freeze`); state stores only counts and
 * currency.
 */

//  icons for employees
import { GiPlasticDuck } from "react-icons/gi";
import { BsBackpack } from "react-icons/bs";
import { BiCoffeeTogo } from "react-icons/bi";

// import icons for navigation tabs
import { FaPeopleGroup } from "react-icons/fa6";
import { MdEmail } from "react-icons/md";
import { FaGithub } from "react-icons/fa";
import { IoSettings } from "react-icons/io5";
import { MdRocketLaunch } from "react-icons/md";

// import icons for projects
import { BsClipboard2CheckFill } from "react-icons/bs"; // to-do list app
import { GiPostStamp } from "react-icons/gi"; // hobby website
import { GiCoinsPile } from "react-icons/gi"; // paradigm-shifting blockchain project

// import icons for gitnub / open source projects
import { FaCircleRadiation } from "react-icons/fa6"; // overReact framework
import { FaFishFins } from "react-icons/fa6"; // blocker containerization platform

// Shared balance numbers and formulas — the single source of truth, also
// imported by the save server (`server/src/validate.js`). This file only
// adds display data (names, icons, descriptions) on top of them; never
// re-type a balance number here, or the client and server will drift.
import * as shared from "../../../shared/game-balance.js";
/**
 * ========================================
 * ARCHITECTURE: Config + State Separation
 * ========================================
 *
 * All game balance data lives in IMMUTABLE CONFIG OBJECTS.
 * State stores only COUNTS and CURRENCY.
 *
 * This separation:
 * - Makes rebalancing easy (adjust config, game instantly rebalances)
 * - Keeps the reducer clean and predictable
 * - Prevents bugs from state-level balance changes
 *
 * NEVER add game balance constants to initialState or functions.
 * Add them to `shared/game-balance.js` instead — the save server reads
 * the same numbers, so a number typed here and a number typed there
 * would drift. See GAME_BALANCE_CONFIG below.
 *
 * Pattern: `export const THING_CONFIG = Object.freeze({ ... })`
 */
// ===== GAME BALANCE CONFIGURATIONS =====
// Mechanics and starting resources come from the shared balance module
// (the save server reads the same numbers). UNLOCK_VISIBILITY_THRESHOLD
// is display-only, so it stays here.
export const GAME_BALANCE_CONFIG = Object.freeze({
  // ==== Game Mechanics ====
  TICK_INTERVAL: shared.BALANCE.mechanics.tickIntervalMs, // Game tick interval in milliseconds
  BASE_LOC_PER_CLICK: shared.BALANCE.mechanics.baseLocPerClick, // Base lines of code per click
  UNLOCK_VISIBILITY_THRESHOLD: 0.1, // 10% progress to start showing locked employee card

  // ==== Starting Resources ====
  STARTING_MONEY: shared.BALANCE.mechanics.startingMoney, // $0.00 in cents
  STARTING_LOC: shared.BALANCE.mechanics.startingLoc, // Starting lines of code
});

// Immutable navigation tab configuration
export const NAV_TABS = Object.freeze([
  { id: "email", label: "Email", Icon: MdEmail },
  { id: "shop", label: "Shop", Icon: FaPeopleGroup },
  { id: "projects", label: "Projects", Icon: MdRocketLaunch },
  { id: "openSource", label: "Open Source", Icon: FaGithub },
  { id: "settings", label: "Settings", Icon: IoSettings },
]);

// Immutable sections configuration (display names and descriptions)
export const SECTIONS_CONFIG = Object.freeze({
  shop: {
    id: "shop",
    displayName: "Hire Devs",
    description:
      "Here you can hire developers to write LOC for you. It's a one time fee per developer, even though that doesn't make any sense. Don't pretend anything about software development makes sense; you pull that thread, no sweater.",
  },
  projects: {
    id: "projects",
    displayName: "Freelance Projects",
    description: "Convert LOC to Money by completing projects",
  },
  openSource: {
    id: "openSource",
    displayName: "GitNub Contributions",
    description:
      "Contribute your LOC to open-source projects to unlock permanent bonuses.",
  },
  settings: {
    id: "settings",
    displayName: "Settings",
    description:
      "Account and game settings — link a save to your account so it survives clearing browser data.",
  },
});

// Immutable employee configuration
// All costs are in CENTS to avoid floating-point errors in idle games
export const EMPLOYEE_CONFIGS = Object.freeze({
  intern: {
    // Balance numbers (cost, LOC/s, multiplier, unlocks) come from shared.
    ...shared.BALANCE.employees.intern,
    name: "Intern",
    Icon: GiPlasticDuck,
    color: "orange",
    description:
      "Thinks git push --force is a Jedi mind trick. Will delete the production database if left unsupervised.",
  },
  junior: {
    // Balance numbers (cost, LOC/s, multiplier, unlocks) come from shared.
    ...shared.BALANCE.employees.junior,
    name: "Junior Developer",
    Icon: BsBackpack,
    color: "brown",
    description:
      "Knows 12 JavaScript frameworks but can't center a div. Will refactor your working code because it 'wasn't dry enough'.",
  },
  senior: {
    // Balance numbers (cost, LOC/s, multiplier, unlocks) come from shared.
    ...shared.BALANCE.employees.senior,
    name: "Senior Developer",
    Icon: BiCoffeeTogo,
    color: "green",
    description:
      "Doesn't use a mouse. Writes code on a mechanical keyboard loud enough to wake the dead. Hates everything you just wrote.",
  },
});

// Immutable AI assistant configuration
// All costs are in CENTS to avoid floating-point errors in idle games
export const AI_ASSISTANT_CONFIGS = Object.freeze({
  noPilot: {
    // Balance numbers come from shared. NoPilot has no buy action yet.
    ...shared.BALANCE.aiAssistants.noPilot,
    name: "GitNub NoPilot",
  },
});

// Immutable freelance projects configuration
// All rewards are in CENTS to avoid floating-point errors in idle games
// Design: Smaller projects have higher $/LOC to reward clicking, larger projects have lower $/LOC to encourage bulk sales
export const FREELANCE_PROJECTS_CONFIG = Object.freeze({
  toDoListApp: {
    // LOC cost and reward come from shared.
    ...shared.BALANCE.freelanceProjects.toDoListApp,
    name: "To Do List App",
    description:
      "A simple to-do list application. Cuz that's never been done before. Ever.",
    icon: BsClipboard2CheckFill,
    color: "brown",
  },
  hobbyWebsite: {
    // LOC cost and reward come from shared.
    ...shared.BALANCE.freelanceProjects.hobbyWebsite,
    name: "Hobby Website",
    description:
      "A personal website for a client to showcase their hobbies. The world needs to know about Bob's passion for stamp collecting.",
    icon: GiPostStamp,
    color: "lightblue",
  },
  paradigmShiftingBlockchainProject: {
    // LOC cost and reward come from shared.
    ...shared.BALANCE.freelanceProjects.paradigmShiftingBlockchainProject,
    name: "Paradigm-Shifting Blockchain Project",
    description:
      "A very useful project that leverages the blockchain to convert hype, overpromises, and investor's money into your money.",
    icon: GiCoinsPile,
    color: "gold",
  },
});

export const OPEN_SOURCE_PROJECTS_CONFIG = Object.freeze({
  overReactFramework: {
    // Levels (and unlock conditions) come from shared.
    ...shared.BALANCE.openSource.overReactFramework,
    name: "OverReact Framework",
    icon: FaCircleRadiation,
    color: "yellow",
    description:
      "An open-source JavaScript framework that makes building web applications unnecessarily complex and bloated.",
  },
  blocker: {
    // Levels (and unlock conditions) come from shared.
    ...shared.BALANCE.openSource.blocker,
    name: "Blocker Containerization Platform",
    icon: FaFishFins,
    color: "teal",
    description:
      "Why fix dependencies when you can ship the whole OS? Blocker wraps your 5KB script in a 4GB virtual environment, ensuring that if it works on your machine, it's now the Ops team's problem.",
  },
});
