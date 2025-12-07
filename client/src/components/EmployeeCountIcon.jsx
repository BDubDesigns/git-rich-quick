import { MdOutlineEmojiPeople } from "react-icons/md"; // 1 person
import { IoPeople } from "react-icons/io5"; // 2 people
import { FaPeopleGroup } from "react-icons/fa6"; // 3 people

/**
 * EmployeeCountIcon
 *
 * Pure component that selects the appropriate people icon based on employee count.
 * This logic is separated because:
 * 1. It has a single responsibility: icon selection
 * 2. It's testable in isolation
 * 3. It can be reused anywhere employee count is displayed
 *
 * @param {number} count - Total number of employees
 * @returns {React.ReactNode} - The appropriate icon component
 */
export function EmployeeCountIcon({ count, size = 30, color = "white" }) {
  // Logic: As count increases, use a more "populated" icon
  if (count > 99) {
    return <FaPeopleGroup size={size} color={color} />;
  } else if (count > 9) {
    return <IoPeople size={size} color={color} />;
  } else {
    return <MdOutlineEmojiPeople size={size} color={color} />;
  }
}
