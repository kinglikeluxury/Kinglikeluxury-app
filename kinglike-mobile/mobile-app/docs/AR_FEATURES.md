# Augmented Reality (AR) Features in Kinglike Luxury

This document explains the AR functionality implemented in the Kinglike Luxury mobile application.

## Overview

The AR feature allows users to visualize property layouts and floor plans in augmented reality before physically visiting them. This provides a more immersive understanding of the property's dimensions and spatial arrangement than traditional 2D floor plans.

## Key Features

1. **3D Model Visualization**: View property floor plans and layouts as 3D models in AR
2. **Interactive Controls**: 
   - Pinch to scale models larger or smaller
   - Drag to move models
   - Rotate models to view from different angles
3. **Surface Detection**: Place models on detected horizontal surfaces
4. **Permissions Management**: Proper camera permission handling for AR functionality

## Technical Implementation

### AR Framework

The AR functionality is implemented using ViroReact, a platform for building AR/VR applications in React Native. Key components include:

- `ViroARSceneNavigator`: The main container for the AR experience
- `ViroARScene`: The scene containing all AR content
- `ViroARPlaneSelector`: Allows placing content on detected surfaces
- `Viro3DObject`: Renders 3D models (GLB format)

### 3D Models

The application supports loading 3D models in GLB format. Models can be:

1. Provided explicitly via URL parameters
2. Generated based on property ID
3. Fallback to a placeholder model if a specific model is unavailable

### Permissions

The AR features require camera permissions:

- Android: Explicit runtime permission requested via PermissionsAndroid API
- iOS: Camera permissions declared in Info.plist (user is prompted on first use)

## User Experience Flow

1. User views a property's details
2. User taps "View in AR" button
3. App requests camera permissions if not already granted
4. AR view initializes and begins plane detection
5. User can place the property layout on any horizontal surface
6. User can manipulate the model (scale, rotate, move)
7. User exits AR view by tapping "Exit AR" button

## Data Requirements

For each property that supports AR visualization:

- Property ID: Used to fetch or construct model URL
- Model URL: Direct link to a 3D model file (optional)
- Floor Plan URL: Direct link to a floor plan model (optional)

## Future Enhancements

Planned enhancements to the AR functionality include:

1. Furniture placement within layouts
2. Material and color customization options
3. Measurements and dimensions display
4. Multi-level floor plan visualization
5. Saving AR screenshots for later reference
6. Environmental lighting adaptation for more realistic visualization

## Technical Requirements

- Android 8.0+ (API level 26)
- ARCore supported device
- iOS 11.0+ with ARKit support
- Device with camera and motion sensors