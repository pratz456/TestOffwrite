"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Input } from './input';
import { Calendar } from 'lucide-react';

interface YearInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  min?: number;
  max?: number;
}

export const YearInput: React.FC<YearInputProps> = ({
  value,
  onChange,
  placeholder = "1990",
  className = "",
  min = 1900,
  max = new Date().getFullYear()
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [isValid, setIsValid] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Generate years array
  const years = Array.from({ length: max - min + 1 }, (_, i) => max - i);

  // Validate year input
  const validateYear = (yearStr: string): boolean => {
    if (!yearStr) return true; // Allow empty for placeholder
    const year = parseInt(yearStr);
    return !isNaN(year) && year >= min && year <= max && yearStr.length === 4;
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    
    // Only allow digits and limit to 4 characters
    if (newValue.length <= 4 && /^\d*$/.test(newValue)) {
      setInputValue(newValue);
      const valid = validateYear(newValue);
      setIsValid(valid);
      
      // Always call onChange to update the form state
      onChange(newValue);
    }
  };

  // Handle year selection from dropdown
  const handleYearSelect = (year: number) => {
    const yearStr = year.toString();
    setInputValue(yearStr);
    setIsValid(true);
    onChange(yearStr);
    setIsOpen(false);
  };

  // Handle input focus
  const handleInputFocus = () => {
    setIsOpen(true);
  };

  // Handle input blur
  const handleInputBlur = (e: React.FocusEvent) => {
    // Don't close if clicking on dropdown
    if (dropdownRef.current && dropdownRef.current.contains(e.relatedTarget as Node)) {
      return;
    }
    setTimeout(() => setIsOpen(false), 150);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) && 
          inputRef.current && !inputRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update input value when prop changes
  useEffect(() => {
    setInputValue(value);
    setIsValid(validateYear(value));
  }, [value, min, max]);

  return (
    <div className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          className={`${className} ${!isValid && inputValue ? 'border-red-500 focus:border-red-500' : ''}`}
          maxLength={4}
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
        >
          <Calendar className="w-4 h-4" />
        </button>
      </div>
      
      {/* Year dropdown */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto"
        >
          <div className="p-2">
            <div className="text-xs text-muted-foreground mb-2 px-2">Select Year</div>
            {years.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => handleYearSelect(year)}
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted focus:bg-muted focus:outline-none ${
                  inputValue === year.toString() ? 'bg-primary/10 text-primary' : ''
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Validation message */}
      {!isValid && inputValue && (
        <p className="text-xs text-red-500 mt-1">
          Please enter a valid year between {min} and {max}
        </p>
      )}
    </div>
  );
};
