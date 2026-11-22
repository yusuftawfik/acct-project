// Small arrow for the collapsible cards (phones only). Points down when open, right when collapsed.
export default function Chevron({ open }) {
  return (
    <svg
      className={`chevron${open ? '' : ' chevron--closed'}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
