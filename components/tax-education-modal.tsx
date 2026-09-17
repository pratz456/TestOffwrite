'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { IRS_CONTENT_DATABASE, type IRSContent } from '@/lib/education/irs-content';
import { 
  BookOpen, 
  FileText, 
  Lightbulb, 
  CheckCircle, 
  AlertCircle, 
  ExternalLink,
  ArrowRight,
  Star,
  Trophy,
  Target,
  X
} from 'lucide-react';

interface TaxEducationModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction?: {
    merchant_name: string;
    amount: number;
    category: string;
    is_deductible: boolean;
    deductible_reason?: string;
    ai?: {
      reasoning?: string;
      irs?: {
        publication?: string;
        section?: string;
      };
    };
  };
  userProfile?: {
    profession: string;
    business_entity_type: string;
    state: string;
  };
}

interface LearningProgress {
  totalLessons: number;
  completedLessons: number;
  currentStreak: number;
  totalPoints: number;
  level: number;
  nextLevelPoints: number;
}

export function TaxEducationModal({ isOpen, onClose, transaction, userProfile }: TaxEducationModalProps) {
  const [activeTab, setActiveTab] = useState('explanation');
  const [learningProgress, setLearningProgress] = useState<LearningProgress>({
    totalLessons: 20,
    completedLessons: 5,
    currentStreak: 3,
    totalPoints: 150,
    level: 2,
    nextLevelPoints: 200
  });
  const [currentContent, setCurrentContent] = useState<IRSContent | null>(null);
  const [isLessonCompleted, setIsLessonCompleted] = useState(false);

  useEffect(() => {
    if (transaction && isOpen) {
      // Determine which IRS content to show based on transaction
      let contentKey = 'meals_50'; // default
      
      if (transaction.category?.toLowerCase().includes('home') || 
          transaction.ai?.reasoning?.toLowerCase().includes('home office')) {
        contentKey = 'home_office';
      } else if (transaction.category?.toLowerCase().includes('vehicle') || 
                 transaction.category?.toLowerCase().includes('mileage')) {
        contentKey = 'vehicle_expense';
      } else if (transaction.category?.toLowerCase().includes('travel')) {
        contentKey = 'travel_expenses';
      } else if (transaction.category?.toLowerCase().includes('meal') || 
                 transaction.merchant_name?.toLowerCase().includes('restaurant')) {
        contentKey = 'meals_50';
      }

      setCurrentContent(IRS_CONTENT_DATABASE[contentKey]);
    }
  }, [transaction, isOpen]);

  const handleCompleteLesson = () => {
    if (!isLessonCompleted) {
      setIsLessonCompleted(true);
      setLearningProgress(prev => ({
        ...prev,
        completedLessons: prev.completedLessons + 1,
        totalPoints: prev.totalPoints + 25,
        currentStreak: prev.currentStreak + 1
      }));
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'beginner': return 'bg-green-100 text-green-800';
      case 'intermediate': return 'bg-yellow-100 text-yellow-800';
      case 'advanced': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getProgressPercentage = () => {
    return (learningProgress.completedLessons / learningProgress.totalLessons) * 100;
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-teal-600" />
            Tax Education Center
          </DialogTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        {/* Learning Progress Banner */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  <span className="font-semibold">Level {learningProgress.level}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-yellow-500" />
                  <span>{learningProgress.totalPoints} points</span>
                </div>
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-blue-500" />
                  <span>{learningProgress.currentStreak} day streak</span>
                </div>
              </div>
              <Badge variant="outline" className="text-sm">
                {learningProgress.completedLessons}/{learningProgress.totalLessons} lessons
              </Badge>
            </div>
            <Progress value={getProgressPercentage()} className="h-2" />
            <p className="text-sm text-muted-foreground mt-2">
              {learningProgress.nextLevelPoints - learningProgress.totalPoints} points to next level
            </p>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="explanation">Explanation</TabsTrigger>
            <TabsTrigger value="irs-content">IRS Guide</TabsTrigger>
            <TabsTrigger value="examples">Examples</TabsTrigger>
            <TabsTrigger value="quiz">Quick Quiz</TabsTrigger>
          </TabsList>

          <TabsContent value="explanation" className="space-y-4">
            {transaction && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-teal-600" />
                    Why {transaction.is_deductible ? 'This Expense May Be Deductible' : 'This Expense Looks Non-Deductible'}
                  </CardTitle>
                  <CardDescription>
                    {transaction.merchant_name} • ${Math.abs(transaction.amount).toFixed(2)} • {transaction.category}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      {transaction.is_deductible ? (
                        <CheckCircle className="h-5 w-5 text-green-500 mt-1" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-500 mt-1" />
                      )}
                      <div>
                        <p className="font-medium">
                          {transaction.is_deductible ? 'Suggested as deductible - confirm the business purpose' : 'Suggested as not deductible - review if you disagree'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {transaction.deductible_reason || transaction.ai?.reasoning || 'No explanation available'}
                        </p>
                      </div>
                    </div>

                    {userProfile && (
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <h4 className="font-medium text-blue-900 mb-2">Personalized for You</h4>
                        <p className="text-sm text-blue-800">
                          As a {userProfile.profession} operating as a {userProfile.business_entity_type} in {userProfile.state},
                          this explanation covers general federal rules for your business context. State tax rules are not analyzed here.
                        </p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setActiveTab('irs-content')}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Read IRS Guide
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setActiveTab('examples')}
                      >
                        <Lightbulb className="h-4 w-4 mr-2" />
                        See Examples
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="irs-content" className="space-y-4">
            {currentContent && (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-blue-600" />
                        {currentContent.title}
                      </CardTitle>
                      <CardDescription className="flex items-center gap-4 mt-2">
                        <span>{currentContent.publication}</span>
                        {currentContent.section && <span>• {currentContent.section}</span>}
                        <Badge className={getDifficultyColor(currentContent.difficulty)}>
                          {currentContent.difficulty}
                        </Badge>
                        <span>• {currentContent.estimatedReadTime} min read</span>
                      </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <a href={currentContent.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View Full Publication
                      </a>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="prose max-w-none">
                    <p className="whitespace-pre-line">{currentContent.content}</p>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3">Key Points to Remember:</h4>
                    <ul className="space-y-2">
                      {currentContent.keyPoints.map((point, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <CheckCircle className="h-4 w-4 text-green-500 mt-1 flex-shrink-0" />
                          <span className="text-sm">{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={handleCompleteLesson} disabled={isLessonCompleted}>
                      {isLessonCompleted ? (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Lesson Completed (+25 points)
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Mark as Complete
                        </>
                      )}
                    </Button>
                    <Button variant="outline" onClick={() => setActiveTab('examples')}>
                      <ArrowRight className="h-4 w-4 mr-2" />
                      See Examples
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="examples" className="space-y-4">
            {currentContent && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-yellow-600" />
                    Real-World Examples
                  </CardTitle>
                  <CardDescription>
                    See how this tax rule applies in common business scenarios
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {currentContent.examples.map((example, index) => (
                      <div key={index} className="border-l-4 border-teal-500 pl-4 py-2">
                        <p className="text-sm">{example}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="quiz" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Quick Knowledge Check</CardTitle>
                <CardDescription>
                  Test your understanding of this tax topic
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    Interactive quiz coming soon! Complete the lesson first to unlock quiz questions.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
