// Format unlock condition for human-readable display
// Number abbreviation (issue #42) — the shared formatter, so large
// unlock targets (e.g. 1,000,000 total LOC) abbreviate like everywhere else.
import { formatNumber } from "../../../shared/formatNumber.js";

const formatCondition = (condition) => {
  switch (condition.type) {
    case "TOTAL_LOC":
      return `Earn ${formatNumber(condition.target)} total lines of code`;
    case "TOTAL_EMPLOYEE_COUNT":
      return `Hire ${formatNumber(condition.target)} employees`;
    case "SPECIFIC_EMPLOYEE_COUNT":
      return `Hire ${formatNumber(condition.target)} ${condition.employeeName}${
        condition.target > 1 ? "s" : ""
      }`;
    default:
      return "Complete an unknown objective";
  }
};

export { formatCondition };
