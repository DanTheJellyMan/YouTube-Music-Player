const template = document.createElement("template");
template.innerHTML = `
<style>
    :host {
        --gap: 2rem;
        --padding: 0px;

        display: flex;
        align-items: center;

        max-width: 100%;
        max-height: 100%;
        padding: 0;
        margin: 0;
        box-sizing: border-box;
        overflow: hidden;

        mask: linear-gradient(
            90deg,
            transparent,
            white calc(var(--padding) * 0.25),
            white calc(100% - (var(--padding) * 1.75)),
            transparent 100%
        );
        scrollbar-width: thin;
    }
    :host(#scroller[no-scroll]) {
        overflow: auto;
    }

    #scroller {
        display: flex;
        flex-wrap: nowrap;
        flex-direction: row;
        justify-content: flex-start;
        align-items: center;
        gap: var(--gap);

        width: max-content;
        height: 100%;
        padding: inherit;
        margin: inherit;
        box-sizing: border-box;

        --translateX: calc(-50% - (var(--gap) / 2));
        animation: slide 10s linear infinite;
    }
    #scroller[no-scroll] {
        animation: none;
    }

    @keyframes slide {
        66% {
            transform: translateX( var(--translateX) );
        }
        100% {
            transform: translateX( var(--translateX) );
        }
    }

    #scroller > slot {
        display: none;
    }
</style>

<div id="scroller">
    <slot>
        <p>content</p>
    </slot>
</div>
`;

export default class CustomMarquee extends HTMLElement {
    constructor(width = 500, height = 250, scrollSpeed = 1, padding = "10%") {
        super();
        const shadow = this.attachShadow({
            "mode": "open",
            "slotAssignment": "manual"
        });
        shadow.appendChild(template.content.cloneNode(true));

        if (!this.getAttribute("width")) {
            this.setAttribute("width", width);
        }
        if (!this.getAttribute("height")) {
            this.setAttribute("height", height);
        }
        if (!this.getAttribute("scroll-speed")) {
            this.setAttribute("scroll-speed", scrollSpeed);
        }
        if (!this.getAttribute("padding")) {
            this.setAttribute("padding", padding);
        }
    }

    connectedCallback() {
        const shadow = this.shadowRoot;
        const scroller = shadow.querySelector("#scroller");
        const slot = scroller.querySelector("slot");
        slot.addEventListener("slotchange", this.initScroller);
        
        this.init(shadow.host.firstChild);
    }

    disconnectedCallback() {
        const slot = this.shadowRoot.querySelector("slot");
        slot.removeEventListener("slotchange", this.initScroller);
    }

    init(element) {
        const slot = this.shadowRoot.querySelector("slot");
        if (!element ||
            element === slot.assignedElements({ "flatten": true })[0]
        ) return;

        while (this.firstChild) this.firstChild.remove();
        const clone = element.cloneNode(true);
        this.appendChild(clone);
        slot.assign(clone);
    }

    /**
     * Must be called from the context of the slot element (use .call() or .apply())
     * 
     * Only call this outside the class if recalculating sizing
     * and assigned slot element hasn't changed. Call .init() instead if possible.
     */
    initScroller() {
        console.log("#initScroller()", this)
        const shadow = this.parentElement.parentNode;
        const host = shadow.host;
        const scroller = shadow.querySelector("#scroller");
        const slot = scroller.querySelector("slot");
        while (scroller.children.length > 1) {
            if (scroller.firstChild === slot) {
                scroller.lastChild.remove();
            } else {
                scroller.firstChild.remove();
            }
        }
        host.style.justifyContent = "flex-start";
        host.style.width = `${host.getAttribute("width")}px`;
        host.style.height = `${host.getAttribute("height")}px`;
        scroller.removeAttribute("no-scroll");
        const hostRect = host.getBoundingClientRect();

        const scrollSpeedMultiplier = parseFloat(host.getAttribute("scroll-speed"));
        const assignedElRect = getAssignedElRect();
        if (!assignedElRect) return;
        const gap = assignedElRect.width / 2;
        const padding = host.getAttribute("padding");
        host.style.setProperty("--gap", `${gap}px`);
        host.style.setProperty("--padding", padding);
        const minTotalWidth = hostRect.width * 2;
        let scrollerWidth = 0, cloneWidth = 0;

        const assignedEl = slot.assignedElements({ "flatten": true })[0];
        const assignedElStyles = CustomMarquee.getElementStyles(assignedEl);
        const allChildren = assignedEl.querySelectorAll("*");
        const allChildrenStyles = Array(allChildren.length);
        for (let i=0; i<allChildren.length; i++) {
            const child = allChildren[i];
            allChildrenStyles[i] = CustomMarquee.getElementStyles(child);
        }

        while ((scrollerWidth = scroller.getBoundingClientRect().width) < minTotalWidth) {
            const clone = assignedEl.cloneNode(true);
            CustomMarquee.setElementStyles(assignedElStyles, clone);
            const allCloneChildren = clone.querySelectorAll("*");
            for (let i=0; i<allCloneChildren.length; i++) {
                CustomMarquee.setElementStyles(allChildrenStyles[i], allCloneChildren[i]);
            }

            scroller.appendChild(clone);
            cloneWidth = clone.getBoundingClientRect().width;
        }

        const defaultSpeed = 100;
        const scrollTime = scrollerWidth / (defaultSpeed * scrollSpeedMultiplier);
        const translateX = (scrollerWidth/-2) - gap/2;
        scroller.style.animationDuration = `${scrollTime}s`;
        scroller.style.setProperty("--translateX", `${translateX}px`);
        
        // if (cloneWidth <= (hostRect.width * 0.75)) {
        //     const nonSlotElements = scroller.querySelectorAll("*:not(slot)");
        //     for (let i=0; i<nonSlotElements.length-1; i++) {
        //         nonSlotElements[i].remove();
        //     }
        //     host.style.justifyContent = "center";
        //     host.style.setProperty("--padding", `0px`);
        //     scroller.setAttribute("no-scroll", "");
        // }

        function getAssignedElRect(index = 0) {
            const assignedEl = slot.assignedElements({ "flatten": true })[index];
            if (!assignedEl) return null;
            const clone = assignedEl.cloneNode(true);
            clone.style.opacity = "0";
            scroller.appendChild(clone);

            const rect = clone.getBoundingClientRect();
            clone.remove();
            return rect;
        }
    }

    static getElementStyles(element) {
        const compStyle = getComputedStyle(element);
        const styles = Array(compStyle.length);
        for (let i=0; i<styles.length; i++) {
            const prop = compStyle[i];
            styles[i] = [ prop, compStyle.getPropertyValue(prop) ];
        }
        return styles;
    }
    static setElementStyles(styles, targetElement) {
        for (const [ prop, val ] of styles) {
            targetElement.style.setProperty(prop, val);
        }
    }
}
customElements.define("custom-marquee", CustomMarquee);