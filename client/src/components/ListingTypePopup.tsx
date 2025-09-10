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
      <DialogContent className="max-w-2xl" data-testid="dialog-listing-type">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            Choose Your Listing Type
          </DialogTitle>
          <p className="text-center text-gray-600">
            Select how you want to list your {propertyType.toLowerCase()}
          </p>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          {/* Free Listing Option */}
          <Card className="border-2 hover:border-gray-300 transition-colors cursor-pointer" onClick={onSelectFree} data-testid="card-free-listing">
            <CardHeader className="text-center pb-4">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <Upload className="w-8 h-8 text-blue-600" />
              </div>
              <CardTitle className="text-xl">Free Listing</CardTitle>
              <CardDescription>Standard property listing</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
          <Card className="border-2 border-yellow-300 hover:border-yellow-400 transition-colors cursor-pointer relative" onClick={onSelectFeatured} data-testid="card-featured-listing">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
              <Badge className="bg-yellow-500 text-black font-bold px-4 py-1">
                <Crown className="w-4 h-4 mr-1" />
                RECOMMENDED
              </Badge>
            </div>
            
            <CardHeader className="text-center pb-4 pt-6">
              <div className="mx-auto w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center mb-4">
                <Star className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-xl">Featured Listing</CardTitle>
              <CardDescription>Premium visibility and placement</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-yellow-600">PAID</div>
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
                  <span className="text-yellow-500 mr-2">⭐</span>
                  <strong>3x more visibility</strong>
                </div>
              </div>
              
              <Button 
                className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600" 
                onClick={onSelectFeatured}
                data-testid="button-select-featured"
              >
                Choose Featured Listing
              </Button>
            </CardContent>
          </Card>
        </div>
        
        <div className="mt-6 text-center">
          <Button variant="ghost" onClick={onClose} data-testid="button-cancel-popup">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}