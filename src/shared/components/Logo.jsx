const Logo = ({ className = "" }) => {
  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <div className="text-2xl font-tech font-bold text-violet-600">
        LOOM
      </div>
    </div>
  );
};

export default Logo;
