export const generatePriorityScore = (urgency) => {
  return Date.now() + (urgency ? 1000000 : 0);
};