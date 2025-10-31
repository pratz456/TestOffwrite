"use client";

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { ArrowLeft, ArrowRight, SkipForward, CheckCircle, CreditCard, Brain } from 'lucide-react';

interface IntroTutorialProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

const tutorialSteps = [
  {
    id: 'welcome',
    title: 'Welcome to WriteOff!',
    description: 'Let\'s get you set up to maximize your tax deductions.',
    icon: CheckCircle,
    content: (
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle className="w-8 h-8 text-blue-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900">Welcome to WriteOff!</h3>
        <p className="text-gray-600">
          WriteOff helps you automatically categorize and track business expenses 
          to maximize your tax deductions. Let&apos;s walk through the setup process.
        </p>
      </div>
    )
  },
  {
    id: 'connect-bank',
    title: 'Connect Your Bank',
    description: 'Securely connect your bank account to automatically import transactions.',
    icon: CreditCard,
    content: (
      <div className="space-y-4">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <CreditCard className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 text-center">Connect Your Bank</h3>
        <div className="space-y-3 text-left">
          <div className="flex items-start space-x-3">
            <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
            <p className="text-gray-600">Securely connect using Plaid (bank-level security)</p>
          </div>
          <div className="flex items-start space-x-3">
            <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
            <p className="text-gray-600">Automatically sync your transactions</p>
          </div>
          <div className="flex items-start space-x-3">
            <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
            <p className="text-gray-600">No manual data entry required</p>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 'auto-analyze',
    title: 'Auto-Analyze & Review',
    description: 'Our AI automatically categorizes transactions and identifies deductions.',
    icon: Brain,
    content: (
      <div className="space-y-4">
        <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto">
          <Brain className="w-8 h-8 text-purple-600" />
        </div>
        <h3 className="text-xl font-semibold text-gray-900 text-center">Auto-Analyze & Review</h3>
        <div className="space-y-3 text-left">
          <div className="flex items-start space-x-3">
            <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 flex-shrink-0"></div>
            <p className="text-gray-600">AI automatically categorizes your transactions</p>
          </div>
          <div className="flex items-start space-x-3">
            <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 flex-shrink-0"></div>
            <p className="text-gray-600">Identifies potential tax deductions</p>
          </div>
          <div className="flex items-start space-x-3">
            <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 flex-shrink-0"></div>
            <p className="text-gray-600">Review and edit categories as needed</p>
          </div>
        </div>
      </div>
    )
  }
];

export function IntroTutorial({ isOpen, onClose, onComplete, onSkip }: IntroTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    if (currentStep < tutorialSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    onSkip();
  };

  const handleComplete = () => {
    onComplete();
  };

  const currentStepData = tutorialSteps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === tutorialSteps.length - 1;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-center">
            {currentStepData.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Progress indicator */}
          <div className="flex justify-center space-x-2">
            {tutorialSteps.map((_, index) => (
              <div
                key={index}
                className={`w-3 h-3 rounded-full ${
                  index === currentStep
                    ? 'bg-blue-600'
                    : index < currentStep
                    ? 'bg-blue-300'
                    : 'bg-gray-200'
                }`}
              />
            ))}
          </div>

          {/* Step content */}
          <div className="min-h-[300px] flex items-center justify-center">
            {currentStepData.content}
          </div>

          {/* Navigation buttons */}
          <div className="flex justify-between items-center">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={isFirstStep}
              className="flex items-center space-x-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </Button>

            <div className="flex space-x-2">
              <Button
                variant="outline"
                onClick={handleSkip}
                className="flex items-center space-x-2"
              >
                <SkipForward className="w-4 h-4" />
                <span>Skip</span>
              </Button>

              <Button
                onClick={isLastStep ? handleComplete : handleNext}
                className="flex items-center space-x-2"
              >
                <span>{isLastStep ? 'Finish' : 'Next'}</span>
                {!isLastStep && <ArrowRight className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
