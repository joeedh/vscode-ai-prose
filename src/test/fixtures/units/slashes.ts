export const x = 1;

// First run line one.
// First run line two.

// Second run after a blank.
const a = 1; // trailing comment is not a run
// Run ending at code.
// Still the run.
function f() {
  // Indented comment.
  //
  // After an empty marker line.
  return 1;
}
/// Doc line.
//! Bang line.
// Items:
// - one
//   continued
// - two
