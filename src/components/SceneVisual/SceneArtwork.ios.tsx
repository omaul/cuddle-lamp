import React from 'react';
import LampSceneView from '../../native/specs/LampSceneViewNativeComponent';
import type { SceneArtworkProps } from './index';
import SharedSceneArtwork from './SharedSceneArtwork';
import styles from './styles';

const SceneArtwork: React.FC<SceneArtworkProps> = (props) => {
    const { sceneId, isPlaying, rms, bells, localMinute, space, isMotionAllowed } = props;
    if (sceneId !== 'focus' && sceneId !== 'relax' && sceneId !== 'sleep') {
        return <SharedSceneArtwork {...props} />;
    }
    return (
        <LampSceneView
            style={styles.canvas}
            pointerEvents="box-none"
            scene={sceneId}
            playing={isPlaying}
            motionAllowed={isMotionAllowed}
            rms={rms}
            localMinute={localMinute}
            bells={bells ?? []}
            space={space}
        />
    );
};

export default SceneArtwork;
