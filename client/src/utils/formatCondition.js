// Format unlock condition for human-readable display
const formatCondition = (condition) => {
  switch (condition.type) {
    case "TOTAL_LOC":
      return `Earn ${condition.required} total lines of code`;
    case "TOTAL_EMPLOYEE_COUNT":
      return `Hire ${condition.required} employees`;
    case "SPECIFIC_EMPLOYEE_COUNT":
      return `Hire ${condition.required} ${condition.employeeType}${
        condition.required > 1 ? "s" : ""
      }`;
    default:
      return "Complete an unknown objective";
  }
};

export { formatCondition };
