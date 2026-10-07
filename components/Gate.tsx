// Scores stay hidden until you vote on the paper (the top 3 of this week's Trending
// are open to everyone). The server renders both the score and a mask; GateRevealer
// swaps them for papers the signed-in reader has voted on.
export function Gate({ id, open, mask, children }: { id: string; open?: boolean; mask: React.ReactNode; children: React.ReactNode }) {
  if (open) return <>{children}</>;
  return (
    <span className="gate" data-gate={id}>
      <span className="gate-real">{children}</span>
      <span className="gate-mask">{mask}</span>
    </span>
  );
}
