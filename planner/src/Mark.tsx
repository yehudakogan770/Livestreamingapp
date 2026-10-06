/** The Lumora mark (public/mark.svg). */
export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  return <img className={className ? `mark ${className}` : 'mark'} src="./mark.svg" alt="" width={size} height={size} />;
}

/** The mark and "Lumora Planner". */
export function Brand({ size = 22 }: { size?: number }) {
  return (
    <div className="brand">
      <Mark size={size} />
      Lumora Planner
    </div>
  );
}
