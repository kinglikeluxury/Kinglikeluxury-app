import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Crown, Star, Upload } from 'lucide-react';

interface ListingTypePopupProps {
  open: boolean;
  onClose: () => void;
  onSelectFree: () => void;
  onSelectFeatured: () => void;
  propertyType: string;
}

export default function ListingTypePopup({ 
  open, 
  onClose, 
  onSelectFree, 
  onSelectFeatured,
  propertyType 
}: ListingTypePopupProps) {
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-6" data-testid="dialog-listing-type">
        <DialogHeader>
          <DialogTitle className="text-xl sm:text-2xl font-bold text-center">
            Choose Your Listing Type
          </DialogTitle>
          <p className="text-center text-gray-600 text-sm">
            Select how you want to list your {propertyType.toLowerCase()}
          </p>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {/* Free Listing Option */}
          <Card className="border-2 hover:border-gray-300 transition-colors cursor-pointer" onClick={onSelectFree} data-testid="card-free-listing">
            <CardHeader className="text-center pb-2 pt-4">
              <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                <Upload className="w-6 h-6 text-blue-600" />
              </div>
              <CardTitle className="text-lg">Free Listing</CardTitle>
              <CardDescription className="text-xs">Standard property listing</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">FREE</div>
                <p className="text-sm text-gray-500">No cost to list</p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center text-sm">
                  <span className="text-green-500 mr-2">✓</span>
                  Standard listing visibility
                </div>
                <div className="flex items-center text-sm">
                  <span className="text-green-500 mr-2">✓</span>
                  Basic property details
                </div>
                <div className="flex items-center text-sm">
                  <span className="text-green-500 mr-2">✓</span>
                  Image gallery
                </div>
                <div className="flex items-center text-sm">
                  <span className="text-green-500 mr-2">✓</span>
                  Contact information
                </div>
              </div>
              
              <Button 
                className="w-full" 
                variant="outline"
                onClick={onSelectFree}
                data-testid="button-select-free"
              >
                Continue with Free Listing
              </Button>
            </CardContent>
          </Card>

          {/* Featured Listing Option */}
          <Card className="border-2 border-primary hover:border-primary/80 transition-colors cursor-pointer relative" onClick={onSelectFeatured} data-testid="card-featured-listing">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
              <Badge className="bg-primary text-white font-bold px-3 py-0.5 text-xs">
                <Crown className="w-3 h-3 mr-1" />
                RECOMMENDED
              </Badge>
            </div>
            
            <CardHeader className="text-center pb-2 pt-5">
              <div className="mx-auto w-12 h-12 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center mb-2">
                <Star className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-lg">Featured Listing</CardTitle>
              <CardDescription className="text-xs">Premium visibility and placement</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">PAID</div>
                <p className="text-sm text-gray-500">Starting from $5</p>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center text-sm">
                  <span className="text-green-500 mr-2">✓</span>
                  <strong>Top priority display</strong>
                </div>
                <div className="flex items-center text-sm">
                  <span className="text-green-500 mr-2">✓</span>
                  <strong>Highlighted listing</strong>
                </div>
                <div className="flex items-center text-sm">
                  <span className="text-green-500 mr-2">✓</span>
                  All free features included
                </div>
                <div className="flex items-center text-sm">
                  <span className="text-primary mr-2">⭐</span>
                  <strong>3x more visibility</strong>
                </div>
              </div>
              
              <Button 
                className="w-full bg-gradient-to-r from-primary to-secondary hover:from-primary/90 hover:to-secondary/90" 
                onClick={onSelectFeatured}
                data-testid="button-select-featured"
              >
                Choose Featured Listing
              </Button>
            </CardContent>
          </Card>
        </div>
        
        <div className="mt-3 text-center">
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-cancel-popup">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}