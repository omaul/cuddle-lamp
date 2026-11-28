import { codegenNativeComponent, type CodegenTypes, type ViewProps } from 'react-native';

interface NativeProps extends ViewProps {
    scene: string;
    playing: boolean;
    motionAllowed: boolean;
    rms: CodegenTypes.Float;
    space: CodegenTypes.Float;
    localMinute: CodegenTypes.Int32;
    frequencyHz: CodegenTypes.Float;
    bells: ReadonlyArray<Readonly<{ midi: CodegenTypes.Int32; level: CodegenTypes.Float }>>;
}

export default codegenNativeComponent<NativeProps>('LampSceneView', { excludedPlatforms: ['android'] });
