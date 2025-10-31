"use client";

import React, { useState, useEffect } from 'react';
import { IntroTutorial } from './intro-tutorial';
import { PlaidGuideTutorial } from './plaid-guide-tutorial';
import { updateUserProfile } from '@/lib/firebase/profiles';

interface TutorialManagerProps {
  userId: string;
  userProfile: any;
  onProfileUpdate: () => void;
}

export function TutorialManager({ userId, userProfile, onProfileUpdate }: TutorialManagerProps) {
  const [showIntroTutorial, setShowIntroTutorial] = useState(false);
  const [showPlaidGuide, setShowPlaidGuide] = useState(false);

  // Check if tutorials should be shown on mount
  useEffect(() => {
    if (userProfile) {
      // Show intro tutorial if not completed
      if (!userProfile.onboardingIntroCompleted) {
        setShowIntroTutorial(true);
      }
      // Show Plaid guide if intro is completed but Plaid guide is not
      else if (userProfile.onboardingIntroCompleted && !userProfile.onboardingPlaidGuideCompleted && userProfile.plaid_token) {
        setShowPlaidGuide(true);
      }
    }
  }, [userProfile]);

  const handleIntroComplete = async () => {
    try {
      await updateUserProfile(userId, { onboardingIntroCompleted: true });
      setShowIntroTutorial(false);
      onProfileUpdate();
      
      // If user has Plaid token, show Plaid guide next
      if (userProfile?.plaid_token && !userProfile?.onboardingPlaidGuideCompleted) {
        setShowPlaidGuide(true);
      }
    } catch (error) {
      console.error('Error updating intro tutorial completion:', error);
    }
  };

  const handleIntroSkip = async () => {
    try {
      await updateUserProfile(userId, { onboardingIntroCompleted: true });
      setShowIntroTutorial(false);
      onProfileUpdate();
      
      // If user has Plaid token, show Plaid guide next
      if (userProfile?.plaid_token && !userProfile?.onboardingPlaidGuideCompleted) {
        setShowPlaidGuide(true);
      }
    } catch (error) {
      console.error('Error updating intro tutorial completion:', error);
    }
  };

  const handlePlaidGuideComplete = async () => {
    try {
      await updateUserProfile(userId, { onboardingPlaidGuideCompleted: true });
      setShowPlaidGuide(false);
      onProfileUpdate();
    } catch (error) {
      console.error('Error updating Plaid guide completion:', error);
    }
  };

  const handlePlaidGuideSkip = async () => {
    try {
      await updateUserProfile(userId, { onboardingPlaidGuideCompleted: true });
      setShowPlaidGuide(false);
      onProfileUpdate();
    } catch (error) {
      console.error('Error updating Plaid guide completion:', error);
    }
  };

  const openIntroTutorial = () => {
    setShowIntroTutorial(true);
  };

  const openPlaidGuide = () => {
    setShowPlaidGuide(true);
  };

  return (
    <>
      {/* Intro Tutorial */}
      <IntroTutorial
        isOpen={showIntroTutorial}
        onClose={() => setShowIntroTutorial(false)}
        onComplete={handleIntroComplete}
        onSkip={handleIntroSkip}
      />

      {/* Plaid Guide Tutorial */}
      <PlaidGuideTutorial
        isOpen={showPlaidGuide}
        onClose={() => setShowPlaidGuide(false)}
        onComplete={handlePlaidGuideComplete}
        onSkip={handlePlaidGuideSkip}
      />

      {/* Tutorial trigger functions for external use */}
      <div style={{ display: 'none' }}>
        <button onClick={openIntroTutorial} id="open-intro-tutorial" />
        <button onClick={openPlaidGuide} id="open-plaid-guide" />
      </div>
    </>
  );
}

// Hook to access tutorial functions from other components
export function useTutorialManager() {
  const openIntroTutorial = () => {
    const button = document.getElementById('open-intro-tutorial');
    if (button) button.click();
  };

  const openPlaidGuide = () => {
    const button = document.getElementById('open-plaid-guide');
    if (button) button.click();
  };

  return { openIntroTutorial, openPlaidGuide };
}
