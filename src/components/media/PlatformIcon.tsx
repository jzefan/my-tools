import React from 'react';
import {
  Video,
  Camera,
  Tv,
  Film,
  Flame,
  BookOpen,
  FileText,
  Newspaper,
  Feather,
  Send,
  Globe,
  LucideProps,
} from 'lucide-react';
import { PlatformType } from '../../types/media';

interface PlatformIconProps extends LucideProps {
  platform: PlatformType | string;
}

export const PlatformIcon: React.FC<PlatformIconProps> = ({ platform, ...props }) => {
  switch (platform) {
    case 'douyin':
      return <Video {...props} />;
    case 'xiaohongshu':
      return <Camera {...props} />;
    case 'bilibili':
      return <Tv {...props} />;
    case 'wechat_channel':
      return <Film {...props} />;
    case 'kuaishou':
      return <Flame {...props} />;
    case 'zhihu':
      return <BookOpen {...props} />;
    case 'wechat_mp':
      return <FileText {...props} />;
    case 'toutiao':
      return <Newspaper {...props} />;
    case 'baijiahao':
      return <Feather {...props} />;
    case 'weibo':
      return <Send {...props} />;
    case 'custom':
    default:
      return <Globe {...props} />;
  }
};
