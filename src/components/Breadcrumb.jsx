function Breadcrumb({ items, onNavigate }) {
  return (
    <nav className="breadcrumb">
      {items.map((item, index) => (
        <span key={index}>
          {index > 0 && <span className="breadcrumb-separator"> › </span>}
          {item.onClick ? (
            <button className="breadcrumb-link" onClick={item.onClick}>
              {item.label}
            </button>
          ) : (
            <span className="breadcrumb-current">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export default Breadcrumb;
