import type { CSSProperties } from 'react';

export const SimpleButton: React.FC<
  React.PropsWithChildren<{
    onClick?: () => unknown;
    content?: React.ReactNode;
    color?: string;
    style?: CSSProperties;
    disabled?: boolean;
  }>
> = ({ onClick, content, children, color, style, disabled }) => {
  return (
    <a
      style={{
        color: color || (disabled ? 'gray' : 'blue'),
        textDecoration: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
        ...style,
      }}
      onClick={() => {
        if (!disabled) onClick?.();
      }}
    >
      {children || content}
    </a>
  );
};
