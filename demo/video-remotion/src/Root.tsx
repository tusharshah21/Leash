import { Composition, Still } from "remotion";
import { LeashDemo } from "./LeashDemo";
import { Thumbnail } from "./Thumbnail";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="LeashDemo" component={LeashDemo} durationInFrames={4725} fps={30} width={1920} height={1080} />
      <Still id="Thumbnail" component={Thumbnail} width={1280} height={720} />
    </>
  );
};
