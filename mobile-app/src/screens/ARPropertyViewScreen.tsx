import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Dimensions,
  PermissionsAndroid,
} from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '@navigation/AppNavigator';
import { COLORS, FONTS, SPACING } from '@lib/theme';
import { getProperty } from '@lib/api';

// Import ViroReact components
import {
  ViroARScene,
  ViroARSceneNavigator,
  ViroText,
  ViroMaterials,
  ViroBox,
  ViroAmbientLight,
  ViroNode,
  ViroConstants,
  ViroARPlaneSelector,
  Viro3DObject,
} from 'viro-react-native';

// Get screen dimensions
const { width, height } = Dimensions.get('window');

type ARPropertyViewRouteProp = RouteProp<RootStackParamList, 'ARPropertyView'>;
type ARPropertyViewNavigationProp = NativeStackNavigationProp<RootStackParamList, 'ARPropertyView'>;

type Props = {
  route: ARPropertyViewRouteProp;
  navigation: ARPropertyViewNavigationProp;
};

// AR Scene component
const ARScene = (props: { floorPlanUrl: string }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [modelScale, setModelScale] = useState([1, 1, 1]);
  const [rotation, setRotation] = useState([0, 0, 0]);
  const [position, setPosition] = useState([0, 0, -2]);

  // Initialize AR scene
  const onInitialized = (state: any, reason: any) => {
    if (state === ViroConstants.TRACKING_NORMAL) {
      setIsLoading(false);
    } else if (state === ViroConstants.TRACKING_NONE) {
      // Handle loss of tracking
    }
  };

  // Scale model when pinch gesture is detected
  const onPinch = (pinchState: any, scaleFactor: number) => {
    if (pinchState === 3) {
      // Scale only on gesture END (3)
      const newScale = [
        modelScale[0] * scaleFactor,
        modelScale[1] * scaleFactor,
        modelScale[2] * scaleFactor,
      ];
      setModelScale(newScale);
    }
  };

  // Rotate model when drag gesture is detected
  const onRotate = (rotateState: any, rotationFactor: number) => {
    if (rotateState === 3) {
      // Rotate only on gesture END (3)
      const newRotation = [
        rotation[0],
        rotation[1] + rotationFactor,
        rotation[2],
      ];
      setRotation(newRotation);
    }
  };

  // Create a default 3D box model if floorPlanUrl is not available or fails to load
  const onError = () => {
    Alert.alert(
      'Model Loading Error',
      'Could not load the 3D model. Using a basic placeholder instead.',
      [{ text: 'OK' }]
    );
    setIsLoading(false);
  };

  return (
    <ViroARScene onTrackingUpdated={onInitialized}>
      <ViroAmbientLight color="#ffffff" intensity={1000} />
      
      {isLoading && (
        <ViroText
          text="Loading 3D model..."
          scale={[0.5, 0.5, 0.5]}
          position={[0, 0, -1]}
          style={arStyles.loadingText}
        />
      )}
      
      <ViroARPlaneSelector>
        {props.floorPlanUrl ? (
          <ViroNode
            position={position}
            dragType="FixedToWorld"
            onDrag={() => {}}
            scale={modelScale}
            rotation={rotation}
            onPinch={onPinch}
            onRotate={onRotate}
          >
            <Viro3DObject
              source={{ uri: props.floorPlanUrl }}
              type="GLB"
              onError={onError}
              onLoadEnd={() => setIsLoading(false)}
              position={[0, 0, 0]}
              scale={[0.1, 0.1, 0.1]}
            />
          </ViroNode>
        ) : (
          <ViroNode
            position={position}
            dragType="FixedToWorld"
            onDrag={() => {}}
            scale={modelScale}
            rotation={rotation}
            onPinch={onPinch}
            onRotate={onRotate}
          >
            <ViroBox
              position={[0, 0, 0]}
              scale={[1, 1, 1]}
              materials={["grid"]}
              onLoadEnd={() => setIsLoading(false)}
            />
          </ViroNode>
        )}
      </ViroARPlaneSelector>
      
      <ViroText
        text="Tap and drag to move / Pinch to resize"
        scale={[0.3, 0.3, 0.3]}
        position={[0, -0.5, -1]}
        style={arStyles.instructionsText}
      />
    </ViroARScene>
  );
};

// Material for placeholder 3D box
ViroMaterials.createMaterials({
  grid: {
    diffuseTexture: { uri: 'https://raw.githubusercontent.com/viromedia/viro/master/js/release/tutorial/360PhotoTour/res/grid_bg.jpg' },
  },
});

// Main screen component
const ARPropertyViewScreen: React.FC<Props> = ({ route, navigation }) => {
  const { propertyId, floorPlanUrl, modelUrl } = route.params;
  const [property, setProperty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [hasARPermissions, setHasARPermissions] = useState(false);
  const [modelUri, setModelUri] = useState<string | null>(null);

  // Request camera permissions on Android
  const requestCameraPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'Kinglike Luxury needs access to your camera to display AR content.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          setHasARPermissions(true);
        } else {
          Alert.alert(
            'Permission Required',
            'Camera permission is required to use the AR feature.',
            [
              { text: 'Cancel', onPress: () => navigation.goBack() },
              { text: 'Try Again', onPress: requestCameraPermission }
            ]
          );
        }
      } catch (err) {
        console.warn(err);
        Alert.alert('Error', 'Failed to request camera permission');
      }
    } else {
      // iOS handles permissions differently through Info.plist
      setHasARPermissions(true);
    }
  };

  // Load property data
  useEffect(() => {
    requestCameraPermission();
    
    async function loadProperty() {
      try {
        const propertyData = await getProperty(propertyId);
        setProperty(propertyData);
        
        // Use provided model URL or construct one based on property ID
        if (modelUrl) {
          setModelUri(modelUrl);
        } else if (floorPlanUrl) {
          setModelUri(floorPlanUrl);
        } else {
          // Use default model URL based on property ID
          setModelUri(`https://kinglikeluxury.com/floor-plans/${propertyId}.glb`);
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Failed to load property:', error);
        Alert.alert(
          'Error',
          'Failed to load property information.',
          [{ text: 'Go Back', onPress: () => navigation.goBack() }]
        );
      }
    }
    
    loadProperty();
  }, [propertyId, floorPlanUrl, modelUrl, navigation]);

  // Render loading state
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading AR experience...</Text>
      </View>
    );
  }

  // Render no permissions state
  if (!hasARPermissions) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          Camera permission is required to use the AR feature.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestCameraPermission}
        >
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Render AR view
  return (
    <View style={styles.container}>
      <ViroARSceneNavigator
        autofocus={true}
        initialScene={{
          scene: () => <ARScene floorPlanUrl={modelUri || ''} />,
        }}
        style={styles.arView}
      />
      
      <View style={styles.controls}>
        <Text style={styles.propertyName}>
          {property?.title || 'Property Layout View'}
        </Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Exit AR</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// AR Scene specific styles
const arStyles = StyleSheet.create({
  loadingText: {
    fontFamily: 'Arial',
    fontSize: 20,
    color: '#ffffff',
    textAlignVertical: 'center',
    textAlign: 'center',
  },
  instructionsText: {
    fontFamily: 'Arial',
    fontSize: 14,
    color: '#ffffff',
    textAlignVertical: 'center',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
  },
});

// Main screen styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: SPACING.medium,
    fontSize: FONTS.sizes.medium,
    color: COLORS.text,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: SPACING.large,
  },
  permissionText: {
    fontSize: FONTS.sizes.medium,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.large,
  },
  permissionButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.medium,
    paddingHorizontal: SPACING.large,
    borderRadius: 8,
  },
  permissionButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.medium,
    fontWeight: 'bold',
  },
  arView: {
    flex: 1,
    width: width,
    height: height,
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: SPACING.medium,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  propertyName: {
    color: COLORS.white,
    fontSize: FONTS.sizes.medium,
    fontWeight: 'bold',
    flex: 1,
  },
  backButton: {
    backgroundColor: COLORS.secondary,
    paddingVertical: SPACING.small,
    paddingHorizontal: SPACING.medium,
    borderRadius: 5,
  },
  backButtonText: {
    color: COLORS.white,
    fontSize: FONTS.sizes.small,
    fontWeight: 'bold',
  },
});

export default ARPropertyViewScreen;