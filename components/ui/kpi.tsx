import * as React from "react";
import { cn } from "@/lib/utils";

interface KPICardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  icon?: React.ReactNode;
  variant?: "default" | "success" | "info";
}

const KPICard = React.forwardRef<HTMLDivElement, KPICardProps>(
  ({ className, title, value, subtitle, trend, icon, variant = "default", ...props }, ref) => {
    const variantStyles = {
      default: "bg-card border-border",
      success: "bg-card border-accent/20",
      info: "bg-card border-primary/20",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-lg border bg-card p-5 md:p-6 transition-shadow duration-200 hover:shadow-md",
          variantStyles[variant],
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-muted-foreground mb-1">
              {title}
            </p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl md:text-3xl font-semibold text-foreground">
                {typeof value === "number" ? `$${value.toLocaleString()}` : value}
              </p>
              {trend && (
                <span
                  className={cn(
                    "text-sm font-medium",
                    trend.isPositive ? "text-accent" : "text-destructive"
                  )}
                >
                  {trend.isPositive ? "+" : ""}{trend.value}%
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-1">
                {subtitle}
              </p>
            )}
          </div>
          {icon && (
            <div className="flex-shrink-0 ml-4">
              {icon}
            </div>
          )}
        </div>
      </div>
    );
  }
);
KPICard.displayName = "KPICard";

export { KPICard };
