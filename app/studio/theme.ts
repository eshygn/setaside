// AG Studio theme for SetAside, adapted from the PayPal AG Studio boilerplate. Every value points at a design token from
// app/globals.css, the same variables the shell's Tailwind classes use, so Studio renders as
// part of the page rather than a component embedded in it: change a token there and the shell,
// widgets, grids and charts all follow.

import { studioTheme } from 'ag-studio';

const token = (name: string) => `var(--sa-${name})`;
const line = (color: string) => ({ width: 1, color: token(color) });

const palette = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [
    [`chartPaletteFills${i + 1}Color`, token(`chart-${i + 1}`)],
    [`chartPaletteStrokes${i + 1}Color`, token(`chart-${i + 1}`)],
  ]).flat(),
);

export const setAsideStudioTheme = studioTheme.withParams({
  // Shared by Studio's UI, grids and charts.
  fontFamily: 'var(--sa-font)',
  fontSize: 14,
  textColor: token('ink'),
  foregroundColor: token('ink'),
  subtleTextColor: token('muted'),
  backgroundColor: token('surface'),
  borderColor: token('line'),
  accentColor: token('forest'),
  iconColor: token('ink'),
  rowHoverColor: token('marigold-soft'),

  // No frame: the canvas is the page's own background. Each widget is inset 12px inside its
  // grid cell, so 20px of padding puts widget edges on the header's 32px gutter.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token('paper'),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token('paper'),
  studioCanvasPadding: 20,
  // Slightly taller rows than the default 16px make room for card padding.
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: 'var(--sa-font)',

  // Widgets are the shell's cards: warm surface, 1px border, 16px radius, serif titles.
  studioWidgetBackgroundColor: token('surface'),
  studioWidgetBorder: line('border'),
  studioWidgetBorderRadius: 16,
  studioWidgetPadding: 10,
  studioWidgetTitleFontFamily: 'var(--sa-display)',
  studioWidgetTitleFontSize: 17,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: token('ink'),
  studioWidgetSubtitleFontFamily: 'var(--sa-font)',
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: token('muted'),
  studioWidgetCaptionFontFamily: 'var(--sa-font)',
  studioWidgetCaptionFontSize: 13,
  studioWidgetCaptionTextColor: token('muted'),
  studioWidgetResizeBorderColor: token('forest'),

  // Edit-mode panels read as more of the sidebar.
  studioPanelContainerBackgroundColor: token('surface'),
  studioPanelContainerBorder: line('border'),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: token('line'),
  studioPanelDividerActiveColor: token('forest'),
  studioPanelSectionBorderColor: token('line'),
  studioPanelHeaderFontFamily: 'var(--sa-font)',
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: token('marigold-soft'),
  studioPanelChevronButtonHoverColor: token('forest'),
  // Selected toggles match the sidebar's selected item: highlight fill, blue text and edge.
  studioToggleButtonActiveBackgroundColor: token('marigold-soft'),
  studioToggleButtonActiveBorderColor: token('forest'),
  studioToggleButtonActiveColor: token('forest'),

  // Grid widgets: muted semibold headers, light dividers, roomy rows.
  gridFontFamily: 'var(--sa-font)',
  gridFontSize: 14,
  gridCellTextColor: token('ink'),
  gridHeaderBackgroundColor: token('surface'),
  gridHeaderTextColor: token('muted'),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 13,
  gridRowHeight: 40,
  gridRowBorder: line('gridline'),
  gridHeaderRowBorder: line('border'),
  gridPinnedRowBorder: line('border'),
  gridRowHoverColor: token('marigold-soft'),
  gridWrapperBorder: false,

  // Charts.
  chartFontFamily: 'var(--sa-font)',
  chartTextColor: token('ink'),
  chartSubtleTextColor: token('muted'),
  chartAxisLineColor: token('line'),
  chartGridLineColor: token('line-soft'),
  ...palette,
});
