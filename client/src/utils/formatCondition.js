// Format unlock condition for human-readable display
const formatCondition = (condition) => {
  switch (condition.type) {
    case "TOTAL_LOC":
      return `Earn ${condition.target} total lines of code`;
    case "TOTAL_EMPLOYEE_COUNT":
      return `Hire ${condition.target} employees`;
    case "SPECIFIC_EMPLOYEE_COUNT":
      return `Hire ${condition.target} ${condition.employeeType}${
        condition.target > 1 ? "s" : ""
      }`;
    default:
      return "Complete an unknown objective";
  }
};

export { formatCondition };
