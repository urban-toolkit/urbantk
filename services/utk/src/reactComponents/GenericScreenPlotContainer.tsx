import { useRef } from "react";
// importing draggable to drag the div around the screen
import Draggable from "react-draggable";

// drag box css
import './Dragbox.css'
// import the bar component to draw bars

// declaring the types of the props
type GenericScreenPlotProps = {
    disp: boolean,
    svgId: string
}

export const GenericScreenPlotContainer = ({
    disp,
    svgId
}: GenericScreenPlotProps
) =>{
    const nodeRef = useRef(null)
    
    return(
        <Draggable nodeRef={nodeRef} defaultPosition={{x: window.innerWidth/1.5, y: -window.innerHeight/1.5}}>
            <div ref={nodeRef} className="drag-box" style={{display: disp? 'block' : 'none', boxShadow: "0px 5px 15px rgba(0, 0, 0, 0.35)", overflow: "auto", maxWidth: window.innerWidth/2, maxHeight: window.innerHeight}}>
                <div id={svgId}>
                </div>
            </div>
        </Draggable>
    )
}