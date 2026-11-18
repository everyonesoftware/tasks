export function createCompletedDisclosure() {
  let date = '', open = false;
  return {
    read(nextDate, observed) {
      if (nextDate && date !== nextDate) { date = nextDate; open = false; }
      else if (observed !== undefined) open = Boolean(observed);
      return open;
    },
    reset() { date = ''; open = false; }
  };
}

// Resolve against the latest server snapshot; never trust an open popup's old row.
export function occurrenceActions(state, id, connected, pending, date) {
  const row = connected && !pending && state?.date === date ? state.today.find(row=>row.occurrenceId === id && row.dueDate <= date) : null;
  return {makeCurrent:Boolean(row && !row.completed),complete:Boolean(row && !row.completed),undo:Boolean(row?.completed)};
}
