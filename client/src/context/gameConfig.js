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
import { FaClipboardList, FaKeyboard, FaShip, FaRocket } from "react-icons/fa";

// import icons for navigation tabs
import { FaPeopleGroup } from "react-icons/fa6";
import { FaGithub } from "react-icons/fa";
import { IoSettings } from "react-icons/io5";
import { MdRocketLaunch } from "react-icons/md";
import { GiBarn } from "react-icons/gi";

// GITMail logo for the Email tab (cropped envelope, no text — the
// "GITMail" text read weird on a button). The PNGs have a black
// background, so the nav button renders it on black, not in a blue
// circle. See NavButton.
import gitmailIcon from "../img/gitmail-icon.png";

// import icons for projects
import { BsClipboard2CheckFill } from "react-icons/bs"; // to-do list app
import { GiPostStamp } from "react-icons/gi"; // hobby website
import { GiCoinsPile } from "react-icons/gi"; // paradigm-shifting blockchain project
import { FaRobot } from "react-icons/fa"; // AI-powered dashboard
import { FaImage } from "react-icons/fa"; // NFT marketplace
import { FaGlobe } from "react-icons/fa"; // metaverse real estate
import { FaAtom } from "react-icons/fa"; // quantum to-do list

// import icons for gitnub / open source projects
import { FaCircleRadiation } from "react-icons/fa6"; // overReact framework
import { FaFishFins } from "react-icons/fa6"; // blocker containerization platform
import { FaStar } from "react-icons/fa"; // gitnub constellation (golden star)

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
  UNLOCK_VISIBILITY_THRESHOLD: shared.UNLOCK_VISIBILITY_THRESHOLD, // 10% progress to start showing locked employee card

  // ==== Starting Resources ====
  STARTING_MONEY: shared.BALANCE.mechanics.startingMoney, // $0.00 in cents
  STARTING_LOC: shared.BALANCE.mechanics.startingLoc, // Starting lines of code
});

// Immutable navigation tab configuration. Most tabs use a react-icon
// (`Icon`); the Email tab uses the GITMail logo image instead
// (`imageSrc`) — see NavButton for how the two render.
export const NAV_TABS = Object.freeze([
  { id: "email", label: "Email", imageSrc: gitmailIcon },
  { id: "shop", label: "Shop", Icon: FaPeopleGroup },
  { id: "projects", label: "Projects", Icon: MdRocketLaunch },
  { id: "openSource", label: "Open Source", Icon: FaGithub },
  { id: "farm", label: "Farm", Icon: GiBarn },
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
  farm: {
    id: "farm",
    displayName: "Llama Farm",
    description:
      "Your staff have been dreaming of quitting to start an alpaca farm. You let them build it, but you never accepted their notice, so they're still employees. The llamas are unionizing. The barn has mood lighting. This is fine.",
  },
  settings: {
    id: "settings",
    displayName: "Settings",
    description:
      "Account and game settings. Link a save to your account so it survives clearing browser data.",
  },
  email: {
    id: "email",
    displayName: "Inbox",
    description:
      "Mail from the game world: hiring leads, unlock notices, star reports. It's not real email; nobody here knows your address, and HR definitely doesn't.",
  },
});

// Immutable employee configuration
// All costs are in CENTS to avoid floating-point errors in idle games
export const EMPLOYEE_CONFIGS = Object.freeze({
  intern: {
    // Balance numbers (cost, LOC/s, multiplier, unlocks) come from shared.
    ...shared.BALANCE.employees.intern,
    name: shared.EMPLOYEE_DISPLAY_NAMES.intern,
    Icon: GiPlasticDuck,
    color: "orange",
    description:
      "Thinks git push --force is a Jedi mind trick. Will delete the production database if left unsupervised.",
  },
  junior: {
    // Balance numbers (cost, LOC/s, multiplier, unlocks) come from shared.
    ...shared.BALANCE.employees.junior,
    name: shared.EMPLOYEE_DISPLAY_NAMES.junior,
    Icon: BsBackpack,
    color: "brown",
    description:
      "Knows 12 JavaScript frameworks but can't center a div. Will refactor your working code because it 'wasn't dry enough'.",
  },
  senior: {
    // Balance numbers (cost, LOC/s, multiplier, unlocks) come from shared.
    ...shared.BALANCE.employees.senior,
    name: shared.EMPLOYEE_DISPLAY_NAMES.senior,
    Icon: BiCoffeeTogo,
    color: "green",
    description:
      "Doesn't use a mouse. Writes code on a mechanical keyboard loud enough to wake the dead. Hates everything you just wrote.",
  },
  projectManager: {
    // Balance numbers (cost, multiplier, unlocks, boost) come from shared.
    ...shared.BALANCE.employees.projectManager,
    name: shared.EMPLOYEE_DISPLAY_NAMES.projectManager,
    Icon: FaClipboardList,
    color: "purple",
    description:
      "Schedules standups nobody asked for and somehow the whole team ships 1% faster per manager. Nobody knows how. Nobody is asking.",
  },
  commitSpecialist: {
    // Balance numbers (cost, multiplier, unlocks, bonus) come from shared.
    ...shared.BALANCE.employees.commitSpecialist,
    name: shared.EMPLOYEE_DISPLAY_NAMES.commitSpecialist,
    Icon: FaKeyboard,
    color: "blue",
    description:
      "Writes commit messages so clean the git log weeps. Each one adds a tenth of a line to every click. It adds up, eventually, if you hire enough of them.",
  },
  releaseManager: {
    // Balance numbers (cost, multiplier, unlocks) come from shared.
    ...shared.BALANCE.employees.releaseManager,
    name: shared.EMPLOYEE_DISPLAY_NAMES.releaseManager,
    Icon: FaShip,
    color: "red",
    description:
      "Reads the release notes, nods solemnly, and ships it on a Friday anyway. Has never read a single line of the code. Assign one to a project and it ships one on a timer, as long as there's LOC to burn.",
  },
});

// Immutable cosmetic configuration (issue #11) — the visual data
// for each cosmetic id. The registry of which cosmetic belongs to
// which slot and what triggers it lives in shared/game-balance.js
// (the server validates against it); this file only adds the
// display data (name, icon, color) on top, the same split as the
// employee configs above.
//
// Shape is { name, Icon, color } — Icon + color, not a fixed React
// element like the issue's sketch (`component: <GiPlasticDuck
// color="bronze" />`), so callers can render the cosmetic at any
// size. Colors are hex: "bronze" is not a CSS color name, so the
// issue's literal color="bronze" would silently fall back.
export const COSMETICS_CONFIG = Object.freeze({
  "intern-icon-bronze": {
    name: "Bronze Duck",
    Icon: GiPlasticDuck,
    color: "#CD7F32",
  },
  "junior-icon-silver": {
    name: "Silver Backpack",
    Icon: BsBackpack,
    color: "#C0C0C0",
  },
  "senior-icon-gold": {
    name: "Gold Coffee",
    Icon: BiCoffeeTogo,
    color: "#FFD700",
  },
  "projectManager-icon-platinum": {
    name: "Platinum Clipboard",
    Icon: FaClipboardList,
    color: "#E5E4E2",
  },
  "commitSpecialist-icon-diamond": {
    name: "Diamond Keyboard",
    Icon: FaKeyboard,
    color: "#B9F2FF",
  },
  "releaseManager-icon-ruby": {
    name: "Ruby Rocket",
    Icon: FaRocket,
    color: "#E0115F",
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
    // LOC cost, reward, and unlock conditions come from shared.
    ...shared.BALANCE.freelanceProjects.toDoListApp,
    name: shared.FREELANCE_PROJECT_DISPLAY_NAMES.toDoListApp,
    description:
      "A simple to-do list application. Cuz that's never been done before. Ever.",
    icon: BsClipboard2CheckFill,
    color: "brown",
  },
  hobbyWebsite: {
    // LOC cost, reward, and unlock conditions come from shared.
    ...shared.BALANCE.freelanceProjects.hobbyWebsite,
    name: shared.FREELANCE_PROJECT_DISPLAY_NAMES.hobbyWebsite,
    description:
      "A personal website for a client to showcase their hobbies. The world needs to know about Bob's passion for stamp collecting.",
    icon: GiPostStamp,
    color: "lightblue",
  },
  paradigmShiftingBlockchainProject: {
    // LOC cost, reward, and unlock conditions come from shared.
    ...shared.BALANCE.freelanceProjects.paradigmShiftingBlockchainProject,
    name: shared.FREELANCE_PROJECT_DISPLAY_NAMES.paradigmShiftingBlockchainProject,
    description:
      "A very useful project that leverages the blockchain to convert hype, overpromises, and investor's money into your money.",
    icon: GiCoinsPile,
    color: "gold",
  },
  aiPoweredDashboard: {
    // LOC cost, reward, and unlock conditions come from shared.
    ...shared.BALANCE.freelanceProjects.aiPoweredDashboard,
    name: shared.FREELANCE_PROJECT_DISPLAY_NAMES.aiPoweredDashboard,
    description:
      "An AI-powered dashboard that generates beautiful reports nobody will ever read. The AI is mostly a random number generator with confidence.",
    icon: FaRobot,
    color: "purple",
  },
  nftMarketplace: {
    // LOC cost, reward, and unlock conditions come from shared.
    ...shared.BALANCE.freelanceProjects.nftMarketplace,
    name: shared.FREELANCE_PROJECT_DISPLAY_NAMES.nftMarketplace,
    description:
      "A marketplace for NFTs of to-do lists. Own a JPEG of someone else's unfinished chores. Yours forever, on the blockchain, until the site goes down.",
    icon: FaImage,
    color: "pink",
  },
  metaverseRealEstate: {
    // LOC cost, reward, and unlock conditions come from shared.
    ...shared.BALANCE.freelanceProjects.metaverseRealEstate,
    name: shared.FREELANCE_PROJECT_DISPLAY_NAMES.metaverseRealEstate,
    description:
      "Virtual land in a metaverse nobody visits. Prime location, zero foot traffic, infinite upside (allegedly).",
    icon: FaGlobe,
    color: "green",
  },
  quantumToDoList: {
    // LOC cost, reward, and unlock conditions come from shared.
    ...shared.BALANCE.freelanceProjects.quantumToDoList,
    name: shared.FREELANCE_PROJECT_DISPLAY_NAMES.quantumToDoList,
    description:
      "A to-do list that is both done and not done until you observe it. Schrodinger's sprint planning, now shipping.",
    icon: FaAtom,
    color: "cyan",
  },
});

export const OPEN_SOURCE_PROJECTS_CONFIG = Object.freeze({
  overReactFramework: {
    // Levels (and unlock conditions) come from shared.
    ...shared.BALANCE.openSource.overReactFramework,
    name: shared.OPEN_SOURCE_DISPLAY_NAMES.overReactFramework,
    icon: FaCircleRadiation,
    color: "yellow",
    description:
      "An open-source JavaScript framework that makes building web applications unnecessarily complex and bloated.",
  },
  blocker: {
    // Levels (and unlock conditions) come from shared.
    ...shared.BALANCE.openSource.blocker,
    name: shared.OPEN_SOURCE_DISPLAY_NAMES.blocker,
    icon: FaFishFins,
    color: "teal",
    description:
      "Why fix dependencies when you can ship the whole OS? Blocker wraps your 5KB script in a 4GB virtual environment, ensuring that if it works on your machine, it's now the Ops team's problem.",
  },
  constellation: {
    // Levels (and unlock conditions) come from shared.
    ...shared.BALANCE.openSource.constellation,
    name: shared.OPEN_SOURCE_DISPLAY_NAMES.constellation,
    icon: FaStar,
    color: "gold",
    description:
      "A constellation of golden stars, hung in the GitNub sky by a dev who clearly had too much time on their hands. Chart more of it and the stars start falling. Click one before it burns out. Mostly good news. Mostly.",
  },
  starBroker: {
    // Levels (and unlock conditions) come from shared.
    ...shared.BALANCE.openSource.starBroker,
    name: shared.OPEN_SOURCE_DISPLAY_NAMES.starBroker,
    icon: FaStar,
    color: "gold",
    description:
      "Why wait for the sky to provide when you can just buy a star? Sacrifice 30 seconds of passive LOC and a golden star falls on demand. Stack it with a natural one for a two-star combo. Each level halves the wait before you can buy another. Fair warning: nobody trusts your commits for a bit after finding out you buy stars.",
  },
});
